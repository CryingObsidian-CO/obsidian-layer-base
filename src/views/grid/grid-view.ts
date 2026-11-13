import {Menu, setIcon, setTooltip} from 'obsidian';
import {t} from '../../i18n';
import {
	HEADER_HEIGHT,
	ROW_NUMBER_COLUMN_WIDTH,
	TAIL_COLUMN_WIDTH,
	columnWidthOf,
	rowHeightOf,
	rowHeightPresetOf,
	wrapsOf,
} from '../../model/layout';
import {
	deserializeCellValue,
	formatCell,
	isDerived,
	isEmptyCell,
	isMissingRequired,
	isReadOnly,
	optionsOf,
	serializeCellValue,
	specFor,
} from '../../model/fields';
import {
	canSummarize,
	summarize,
	summaryChoicesFor,
	type SummaryKind,
} from '../../model/summary';
import {summaryLabel} from '../../ui/summary-text';
import {noteLabel} from '../../model/note-path';
import type {RelationCandidate} from '../../model/relation';
import type {
	CellValue,
	Field,
	GridView,
	LayerDoc,
	LayerRecord,
	NoteLabelStyle,
	SelectOption,
	View,
} from '../../types';
import {renderOptionPill} from '../../ui/option-pill';
import {beginCellEdit, type CellEditHandle} from './cell-editor';
import {attachColumnDrag} from './column-drag';
import {attachRangeDrag, type RangeDragHandle} from './range-drag';
import {
	showGridContextMenu,
	type ContextTarget,
} from './grid-context-menu';
import {attachColumnResize, attachRowResize} from './resize';
import {fillableFields} from './fill';
import {
	SelectionTracker,
	rangeBounds,
	rangeSize,
	wholeTableCorners,
	type GridSelection,
	type RangeBounds,
	type RangeSize,
} from './selection';

export interface GridHandlers {
	onCellCommit(recordId: string, field: Field, value: CellValue): void;

	onInsertRecordsBelow(recordId: string, count: number): void;

	onDuplicateRecords(recordIds: string[]): void;

	onDeleteRecords(recordIds: string[]): void;

	onClearRecord(recordId: string): void;

	onSetSummary(fieldId: string, kind: SummaryKind): void;

	onEditField(field: Field, at: { x: number; y: number } | null): void;

	onAddField(after?: Field, anchor?: HTMLElement | null): void;

	onDuplicateField(field: Field): void;

	onDeleteField(field: Field): void;

	onClearCells(recordIds: string[], fields: Field[]): void;

	/** The grid cannot reach the vault itself. */
	onOpenNote(path: string): void;

	noteLabelStyle(): NoteLabelStyle;

	notePropText(field: Field, recordId: string): CellText;

	onCreateOption(field: Field, name: string): SelectOption | null;

	relationCandidates(field: Field): readonly RelationCandidate[];

	relationText(field: Field, value: CellValue): CellText;

	backText(field: Field, recordId: string): CellText;

	formulaText(field: Field, recordId: string): CellText;

	rollupText(field: Field, recordId: string): CellText;
	lookupText(field: Field, recordId: string): CellText;

	autoNumberText(field: Field, recordId: string): CellText;

	// Asked by the footer, so a total adds up what is on screen — including the columns the view
	// computes, which store nothing to add up.
	cellText(field: Field, record: LayerRecord): string;

	onCopyRange(recordIds: string[], fields: Field[]): void;

	onPasteInto(recordIds: string[], fields: Field[]): void;

	onSelectionChange(
		selection: GridSelection | null,
		range: RangeSize | null,
	): void;

	onColumnResize(fieldId: string, width: number): void;

	onReorderField(fieldId: string, beforeFieldId: string | null): void;

	onRowResize(recordId: string, height: number): void;

	/** Resolved by the view: a colour rule is a condition, answered where the document is at hand. */
	rowColor(record: LayerRecord): string | null;
}

export class GridRenderer {
	private cells = new Map<string, HTMLElement>();
	private rows = new Map<string, HTMLElement>();
	private rowNumbers = new Map<string, HTMLElement>();
	private headers = new Map<string, HTMLElement>();
	private cols = new Map<string, HTMLTableColElement>();
	private fit: HTMLElement | null = null;
	private table: HTMLTableElement | null = null;
	private view: GridView | null = null;
	private shownRows: readonly LayerRecord[] = [];
	private scroller: HTMLElement | null = null;
	// Held rather than applied at once: the table's width is not settled yet.
	private pendingOffset: { left: number; top: number } | null = null;

	offset(): { left: number; top: number } {
		return { left: this.scrollLeft(), top: this.scrollTop() };
	}

	// Called before `render`, which empties the host: applying the offset afterwards would race it.
	restoreTo(left: number, top: number): void {
		this.pendingOffset = { left, top };
	}

	private scrollLeft(): number {
		return this.scroller?.scrollLeft ?? 0;
	}

	private scrollTop(): number {
		return this.scroller?.scrollTop ?? 0;
	}

	// Deferred a frame: a browser clamps an offset past the current scroll range, so restoring
	// before the table has been laid out would silently land at the start.
	private restoreScroll(left: number, top: number): void {
		if (left === 0 && top === 0) {
			return;
		}
		window.requestAnimationFrame(() => {
			const scroller = this.scroller;
			if (!scroller) {
				return;
			}
			if (left !== 0) {
				scroller.scrollLeft = left;
			}
			if (top !== 0) {
				scroller.scrollTop = top;
			}
		});
	}
	private visible: Field[] = [];
	private tailHead: HTMLElement | null = null;
	private ignoreNextColumnClick = false;
	private readonly columnDragTeardowns: (() => void)[] = [];
	private rowIndex = new Map<string, number>();
	private columnIndex = new Map<string, number>();
	private recordOrder: string[] = [];
	private marquee: HTMLElement | null = null;
	private marqueeHost: HTMLElement | null = null;
	private rangeDrag: RangeDragHandle | null = null;
	private openEdit: CellEditHandle | null = null;

	private readonly selection: SelectionTracker;

	constructor(
		private readonly host: HTMLElement,
		private readonly handlers: GridHandlers,
	) {
		this.selection = new SelectionTracker((target) => this.resolve(target));
	}

	render(doc: LayerDoc, view: GridView, order?: readonly LayerRecord[]): void {
		// Both offsets are read before the host is emptied, which throws the scroller away.
		const kept = this.pendingOffset ?? {
			left: this.scrollLeft(),
			top: this.scrollTop(),
		};
		this.pendingOffset = null;

		// The cell an editor was in is gone, so the handle must not outlive it.
		this.openEdit = null;
		this.host.empty();
		this.host.addClass('layer-grid');
		// The stylesheet draws the height and wrapping, and must know before rows are measured:
		// the compact height only fits a line once the cell's padding has shrunk with it.
		this.host.toggleClass('is-compact', rowHeightPresetOf(view) === 'compact');
		this.host.toggleClass('is-wrapped', wrapsOf(view));
		this.cells.clear();
		this.rows.clear();
		this.rowNumbers.clear();
		this.headers.clear();
		this.cols.clear();
		this.disposeColumnDrags();
		this.rangeDrag?.teardown();
		this.rangeDrag = null;
		this.tailHead = null;
		this.rowIndex.clear();
		this.columnIndex.clear();
		this.recordOrder.length = 0;
		this.marquee = null;
		this.table = null;
		this.view = null;
		this.shownRows = [];

		const fields = visibleFields(doc, view);
		this.visible = fields;
		fields.forEach((field, position) => {
			this.columnIndex.set(field.id, position);
		});
		if (fields.length === 0) {
			renderEmptyState(this.host, 'inbox', t().gridNoFields, t().gridNoFieldsHint);
			return;
		}

		const scroll = this.host.createDiv({cls: 'layer-grid-scroll'});
		this.scroller = scroll;
		const fit = scroll.createDiv({cls: 'layer-grid-fit'});
		this.fit = fit;
		this.marqueeHost = fit;
		const table = fit.createEl('table', {cls: 'layer-grid-table'});
		this.table = table;
		this.view = view;
		this.shownRows = order ?? doc.records;

		scroll.addEventListener('mousedown', (event) => {
			if (event.target === scroll || event.target === fit || event.target === table) {
				this.setSelection(null);
			}
		});

		this.rangeDrag = attachRangeDrag(table, {
			onStart: (cell) => {
				this.setSelection({kind: 'range', anchor: cell, focus: cell});
			},
			onExtend: (cell) => {
				const current = this.selection.get();
				if (current?.kind !== 'range') {
					return;
				}
				this.setSelection({kind: 'range', anchor: current.anchor, focus: cell});
			},
			onEnd: () => {
			},
		});

		this.renderColgroup(table, fields, view);
		this.renderHead(table, doc, fields, view);
		this.renderBody(table, doc, fields, view, order);
		// The footer totals the rows on screen, not everything stored.
		this.renderFoot(table, fields, view, order ?? doc.records);

		this.restoreScroll(kept.left, kept.top);

		this.marquee = fit.createDiv({cls: 'layer-grid-marquee'});

		this.selection.refresh();
	}

	renderedOrder(): { recordIds: string[]; fields: Field[] } {
		return {recordIds: [...this.recordOrder], fields: [...this.visible]};
	}

	revealRecord(recordId: string): void {
		const row = this.rows.get(recordId);
		if (!row) {
			return;
		}
		this.setSelection({kind: 'row', recordId});
		row.scrollIntoView({block: 'nearest'});
	}

	headerFor(fieldId: string): HTMLElement | null {
		return this.headers.get(fieldId) ?? null;
	}

	private renderColgroup(
		table: HTMLTableElement,
		fields: Field[],
		view: GridView,
	): void {
		const group = table.createEl('colgroup');

		const rownum = group.createEl('col');
		rownum.style.width = `${ROW_NUMBER_COLUMN_WIDTH}px`;

		for (const field of fields) {
			const col = group.createEl('col');
			col.style.width = `${columnWidthOf(view, field.id)}px`;
			this.cols.set(field.id, col);
		}

		const tail = group.createEl('col');
		tail.style.width = `${TAIL_COLUMN_WIDTH}px`;

		this.applyTableWidth();
	}

	private applyTableWidth(): void {
		let total = ROW_NUMBER_COLUMN_WIDTH + TAIL_COLUMN_WIDTH;
		for (const col of this.cols.values()) {
			total += Number.parseFloat(col.style.width) || 0;
		}
		if (this.fit) {
			this.fit.style.width = `${total}px`;
		}
	}

	private renderHead(
		table: HTMLTableElement,
		doc: LayerDoc,
		fields: Field[],
		view: GridView,
	): void {
		const row = table.createTHead().insertRow();
		row.style.height = `${HEADER_HEIGHT}px`;

		this.renderHeadSelectAll(row.insertCell(), doc.records.length > 0);

		for (const field of fields) {
			const th = row.insertCell();
			th.addClass('layer-grid-th', 'is-clickable');
			if (field.primary) {
				th.addClass('is-primary');
			}
			if (isReadOnly(field.type)) {
				th.addClass('is-derived');
				const lock = th.createSpan({cls: 'layer-grid-derived-icon'});
				setIcon(lock, 'lock');
				// The numbering column gets its own wording; the rest share one.
				const hint =
					field.type === 'autoNumber'
						? t().fieldAutoNumberLockHint
						: t().fieldDerivedHint;
				// Obsidian's own tooltip; a `title` as well would draw a second one.
				setTooltip(lock, hint);
				lock.setAttribute('aria-label', hint);
			}
			const icon = th.createSpan({cls: 'layer-grid-type-icon'});
			setIcon(icon, specFor(field.type).icon);
			th.createSpan({cls: 'layer-grid-th-name', text: field.name});

			// A sorted column says so, with the rank when there is more than one rule.
			const sortIndex = view.sorts.findIndex(
				(sort) => sort.fieldId === field.id,
			);
			if (sortIndex !== -1) {
				const sort = view.sorts[sortIndex];
				th.addClass('is-sorted');
				const badge = th.createSpan({ cls: 'layer-grid-th-sort' });
				setIcon(
					badge,
					sort?.order === 'desc' ? 'arrow-down' : 'arrow-up',
				);
				if (view.sorts.length > 1) {
					badge.createSpan({
						cls: 'layer-grid-th-sort-rank',
						text: String(sortIndex + 1),
					});
				}
				badge.setAttribute(
					'aria-label',
					sort?.order === 'desc' ? t().sortDesc : t().sortAsc,
				);
			}

			this.headers.set(field.id, th);
			this.attachColumnResizer(th, field, view);
			this.attachColumnReorder(th, field);
			th.addEventListener('click', (event) => {
				event.preventDefault();
				if (this.ignoreNextColumnClick) {
					this.ignoreNextColumnClick = false;
					return;
				}
				this.setSelection({kind: 'column', fieldId: field.id});
			});
			th.addEventListener('dblclick', (event) => {
				event.preventDefault();
				this.handlers.onEditField(field, {
					x: event.clientX,
					y: event.clientY,
				});
			});
			th.addEventListener('contextmenu', (event) => {
				event.preventDefault();
				this.showMenu(event, {
					kind: 'column',
					field,
					isOnlyField: fields.length <= 1,
				});
			});
		}

		const addHead = row.insertCell();
		addHead.addClass('layer-grid-th', 'layer-grid-add-field');
		this.tailHead = addHead;
		const button = addHead.createEl('button', {
			cls: 'layer-grid-add-field-button',
		});
		button.setAttribute('aria-label', t().addField);
		setIcon(button, 'plus');
		button.addEventListener('click', (event) => {
			event.preventDefault();
			this.handlers.onAddField(undefined, button);
		});
	}

	// The same range a drag from the first cell to the last would draw, so nothing downstream
	// needs a "select all" case of its own.
	private renderHeadSelectAll(
		cell: HTMLTableCellElement,
		enabled: boolean,
	): void {
		cell.addClass('layer-grid-th', 'layer-grid-rownum', 'layer-grid-corner');

		const button = cell.createEl('button', {cls: 'layer-grid-select-all'});
		button.setAttribute('aria-label', t().selectAll);
		setIcon(button, 'move-diagonal');
		// Nothing to select on an empty table, and a button that does nothing is worse than a
		// disabled one.
		button.toggleClass('is-disabled', !enabled);
		button.disabled = !enabled;
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.selectAll();
		});
	}

	private selectAll(): void {
		const whole = wholeTableCorners(
			[...this.rowIndex.keys()],
			[...this.columnIndex.keys()],
		);
		if (!whole) {
			return;
		}
		this.setSelection(whole);
	}

	private attachColumnResizer(
		th: HTMLElement,
		field: Field,
		view: GridView,
	): void {
		const handle = th.createSpan({cls: 'layer-grid-resizer'});
		attachColumnResize(handle, {
			onStart: () => {
				const col = this.cols.get(field.id);
				// The inline width is what the last drag left; the document is the fallback for a
				// column that has never been dragged.
				return col?.style.width
					? Number.parseFloat(col.style.width)
					: columnWidthOf(view, field.id);
			},
			onPreview: (pixels) => {
				const col = this.cols.get(field.id);
				if (col) {
					col.style.width = `${pixels}px`;
				}
				this.applyTableWidth();
				this.paintMarquee(this.selection.get());
			},
			onCommit: (pixels) => this.handlers.onColumnResize(field.id, pixels),
		});
	}

	private attachColumnReorder(th: HTMLElement, field: Field): void {
		const teardown = attachColumnDrag(th, field.id, {
			onStart: (fieldId) => {
				this.headers.get(fieldId)?.addClass('is-dragging-column');
			},
			onMove: (fieldId, clientX) => {
				this.showDropTarget(fieldId, clientX);
			},
			onDrop: (fieldId, clientX) => {
				this.ignoreNextColumnClick = true;
				this.clearDropTarget();
				this.headers.get(fieldId)?.removeClass('is-dragging-column');
				this.handlers.onReorderField(fieldId, this.dropAnchorAt(fieldId, clientX));
			},
			onCancel: () => {
				this.clearDropTarget();
				for (const header of this.headers.values()) {
					header.removeClass('is-dragging-column');
				}
			},
		});
		this.columnDragTeardowns.push(teardown);
	}

	private disposeColumnDrags(): void {
		for (const teardown of this.columnDragTeardowns.splice(0)) {
			teardown();
		}
	}

	private dropAnchorAt(draggedId: string, clientX: number): string | null {
		for (const field of this.visible) {
			if (field.id === draggedId) {
				continue;
			}
			const header = this.headers.get(field.id);
			if (!header) {
				continue;
			}
			const rect = header.getBoundingClientRect();
			if (clientX < rect.left + rect.width / 2) {
				return field.id;
			}
		}
		return null;
	}

	private showDropTarget(draggedId: string, clientX: number): void {
		this.clearDropTarget();
		const anchor = this.dropAnchorAt(draggedId, clientX);
		// One bar per gap: two would read as two insertion points.
		const target =
			anchor === null ? this.tailHead : this.headers.get(anchor);
		target?.addClass('is-drop-before');
	}

	private clearDropTarget(): void {
		for (const header of this.headers.values()) {
			header.removeClass('is-drop-before');
		}
		this.tailHead?.removeClass('is-drop-before');
	}

	// A real `tfoot` rather than a detached strip, so it scrolls and lines up with the columns
	// without any measuring.
	private renderFoot(
		table: HTMLTableElement,
		fields: Field[],
		view: GridView,
		rows: readonly LayerRecord[],
	): void {
		const foot = table.createTFoot();
		const row = foot.insertRow();
		row.addClass('layer-grid-foot-row');

		// Under the row-number column: nothing to report, but it keeps the row aligned.
		const label = row.insertCell();
		label.addClass('layer-grid-foot-label');

		for (const field of fields) {
			const cell = row.insertCell();
			cell.addClass('layer-grid-foot', 'is-clickable');
			const kind = this.currentKind(view, field);
			const text = summarize(field, rows, kind, (record) =>
				this.handlers.cellText(field, record),
			);
			cell.setText(kind === 'none' ? t().summaryNone : text);
			setTooltip(
				cell,
				kind === 'none' ? t().summaryChoose : t().summaryFor(summaryLabel(kind)),
			);
			cell.addEventListener('click', (event) => {
				event.preventDefault();
				this.showSummaryMenu(cell, field, view);
			});
		}

		row.insertCell().addClass('layer-grid-foot');
	}

	private summaryChoices(field: Field): readonly SummaryKind[] {
		return summaryChoicesFor(field);
	}

	private currentKind(view: GridView, field: Field): SummaryKind {
		const chosen = view.summaries?.[field.id];
		return chosen !== undefined && canSummarize(field, chosen) ? chosen : 'none';
	}

	private showSummaryMenu(cell: HTMLElement, field: Field, view: GridView): void {
		const current = this.currentKind(view, field);
		const menu = new Menu();
		for (const kind of this.summaryChoices(field)) {
			menu.addItem((item) =>
				item
					.setTitle(summaryLabel(kind))
					.setChecked(kind === current)
					.onClick(() => this.handlers.onSetSummary(field.id, kind)),
			);
		}
		const box = cell.getBoundingClientRect();
		menu.showAtPosition({ x: box.left, y: box.top });
	}

	private renderBody(
		table: HTMLTableElement,
		doc: LayerDoc,
		fields: Field[],
		view: GridView,
		order?: readonly LayerRecord[],
	): void {
		const body = table.createTBody();
		// Row number, one per field, and the header's trailing add-column cell.
		const columnCount = fields.length + 2;

		const drawn = order ?? doc.records;
		if (drawn.length === 0) {
			const row = body.insertRow();
			row.addClass('layer-grid-row', 'is-empty');
			const cell = row.insertCell();
			cell.colSpan = columnCount;
			cell.addClass('layer-grid-td', 'layer-grid-empty-cell');
			renderEmptyState(cell, 'inbox', t().gridNoRecords, t().gridNoRecordsHint);
			return;
		}

		for (const [index, record] of drawn.entries()) {
			const row = body.insertRow();
			row.addClass('layer-grid-row');
			row.dataset.recordId = record.id;
			row.style.height = `${rowHeightOf(view, record.id)}px`;
			const tint = this.handlers.rowColor(record);
			if (tint !== null) {
				row.addClass('is-colored');
				row.style.setProperty('--layer-row-tint', tint);
			}
			this.rows.set(record.id, row);
			this.rowIndex.set(record.id, index);
			this.recordOrder.push(record.id);

			this.renderRowNumber(row, record.id, index + 1, view);

			for (const field of fields) {
				const cell = row.insertCell();
				cell.addClass('layer-grid-td', `is-${field.type}`);
				cell.dataset.fieldId = field.id;
				// `isReadOnly`, not `isDerived`: a note property is answered by its note but is
				// still the reader's to change, so it must not look like a locked cell.
				if (isReadOnly(field.type)) {
					cell.addClass('is-derived');
				}
				if (field.primary) {
					cell.addClass('is-primary');
				}
				this.cells.set(cellKey(record.id, field.id), cell);
				this.paintCell(cell, field, record.id, record.cells[field.id] ?? '');
			}
		}
	}

	private renderRowNumber(
		row: HTMLTableRowElement,
		recordId: string,
		displayNumber: number,
		view: GridView,
	): void {
		const cell = row.insertCell();
		cell.addClass('layer-grid-td', 'layer-grid-rownum');
		cell.createSpan({
			cls: 'layer-grid-rownum-label',
			text: String(displayNumber),
		});

		const handle = cell.createSpan({cls: 'layer-grid-resizer'});
		attachRowResize(handle, {
			onStart: () => Number.parseFloat(row.style.height) || rowHeightOf(view, recordId),
			onPreview: (pixels) => {
				row.style.height = `${pixels}px`;
				this.paintMarquee(this.selection.get());
			},
			onCommit: (pixels) => this.handlers.onRowResize(recordId, pixels),
		});

		cell.addEventListener('click', (event) => {
			event.preventDefault();
			this.setSelection({kind: 'row', recordId});
		});
		cell.addEventListener('contextmenu', (event) => {
			event.preventDefault();
			this.showMenu(event, {
				kind: 'row',
				recordId,
				index: displayNumber,
				fields: this.visible,
			});
		});
		this.rowNumbers.set(recordId, cell);
	}

	private setSelection(selection: GridSelection | null): void {
		this.selection.apply(selection);
		this.handlers.onSelectionChange(selection, this.selectionSize(selection));
	}

	private selectionSize(selection: GridSelection | null): RangeSize | null {
		if (!selection || selection.kind !== 'range') {
			return null;
		}
		const bounds = this.boundsOf(selection);
		return bounds ? rangeSize(bounds) : null;
	}

	private resolve(selection: GridSelection): HTMLElement[] {
		this.paintMarquee(selection);

		if (selection.kind === 'row') {
			return [this.rows.get(selection.recordId)].filter(isElement);
		}
		if (selection.kind === 'column') {
			const column: HTMLElement[] = [];
			const header = this.headers.get(selection.fieldId);
			if (header) {
				column.push(header);
			}
			for (const [key, cell] of this.cells) {
				if (key.endsWith(`\u0000${selection.fieldId}`)) {
					column.push(cell);
				}
			}
			return column;
		}

		const bounds = this.boundsOf(selection);
		if (!bounds) {
			return [];
		}
		const covered: HTMLElement[] = [];
		const recordIds = [...this.rowIndex.keys()];
		const fieldIds = [...this.columnIndex.keys()];
		for (let row = bounds.top; row <= bounds.bottom; row++) {
			const recordId = recordIds[row];
			if (recordId === undefined) {
				continue;
			}
			for (let column = bounds.left; column <= bounds.right; column++) {
				const fieldId = fieldIds[column];
				if (fieldId === undefined) {
					continue;
				}
				const cell = this.cells.get(cellKey(recordId, fieldId));
				if (cell) {
					covered.push(cell);
				}
			}
		}
		return covered;
	}

	private boundsOf(
		selection: Extract<GridSelection, { kind: 'range' }>,
	): RangeBounds | null {
		return rangeBounds(
			selection.anchor,
			selection.focus,
			this.rowIndex,
			this.columnIndex,
		);
	}

	private paintMarquee(selection: GridSelection | null): void {
		const marquee = this.marquee;
		if (!marquee) {
			return;
		}

		const hide = () => marquee.removeClass('is-visible');

		if (!selection || selection.kind !== 'range') {
			hide();
			return;
		}

		const bounds = this.boundsOf(selection);
		const host = this.marqueeHost;
		if (!bounds || !host) {
			hide();
			return;
		}

		const first = this.cellAt(bounds.top, bounds.left);
		const last = this.cellAt(bounds.bottom, bounds.right);
		if (!first || !last) {
			hide();
			return;
		}

		const hostRect = host.getBoundingClientRect();
		const firstRect = first.getBoundingClientRect();
		const lastRect = last.getBoundingClientRect();

		marquee.setCssProps({
			left: `${firstRect.left - hostRect.left}px`,
			top: `${firstRect.top - hostRect.top}px`,
			width: `${lastRect.right - firstRect.left}px`,
			height: `${lastRect.bottom - firstRect.top}px`,
		});
		marquee.addClass('is-visible');
	}

	private cellAt(row: number, column: number): HTMLElement | undefined {
		const recordId = [...this.rowIndex.keys()][row];
		const fieldId = [...this.columnIndex.keys()][column];
		if (recordId === undefined || fieldId === undefined) {
			return undefined;
		}
		return this.cells.get(cellKey(recordId, fieldId));
	}

	private paintCell(
		cell: HTMLElement,
		field: Field,
		recordId: string,
		value: CellValue,
	): void {
		renderCellValue(
			cell,
			field,
			value,
			this.formatter(),
			recordId,
			(path) => this.handlers.onOpenNote(path),
			this.handlers.noteLabelStyle(),
		);
		// `dataset` holds strings only; `fillRange` parses this back.
		cell.dataset.value = serializeCellValue(value);

		cell.onclick = (event) => {
			event.preventDefault();
			if (this.rangeDrag?.consumeStaleClick()) {
				return;
			}
			// A checkbox toggles on one press without reselecting: ticking a box must leave the
			// selected range alone.
			if (field.type === 'checkbox' && isCheckboxBox(event)) {
				this.commit(cell, field, recordId, value !== true);
				return;
			}
			this.setSelection({
				kind: 'range',
				anchor: {recordId, fieldId: field.id},
				focus: {recordId, fieldId: field.id},
			});
		};

		cell.ondblclick = (event) => {
			event.preventDefault();
			// Whether a type has an editor is `beginCellEdit`'s decision, not a second list here.
			this.beginEdit(cell, field, recordId, value);
		};

		cell.oncontextmenu = (event) => {
			event.preventDefault();
			this.showRangeMenu(event, recordId, field);
		};
	}

	private showRangeMenu(
		event: MouseEvent,
		recordId: string,
		field: Field,
	): void {
		const current = this.selection.get();
		const clicked = {recordId, fieldId: field.id};
		const inside =
			current?.kind === 'range' &&
			this.rangeContains(current, clicked);

		if (!inside) {
			this.setSelection({kind: 'range', anchor: clicked, focus: clicked});
		}

		const active = this.selection.get();
		const bounds =
			active?.kind === 'range' ? this.boundsOf(active) : null;
		if (!bounds) {
			return;
		}

		const recordIds = this.recordOrder.slice(bounds.top, bounds.bottom + 1);
		const fields = this.visible.slice(bounds.left, bounds.right + 1);

		let allEmpty = true;
		for (const id of recordIds) {
			for (const f of fields) {
				const cell = this.cells.get(cellKey(id, f.id));
				if (cell && !cell.hasClass('layer-grid-placeholder')) {
					allEmpty = false;
					break;
				}
			}
			if (!allEmpty) {
				break;
			}
		}

		this.showMenu(event, {
			kind: 'range',
			recordIds,
			fields,
			allEmpty,
		});
	}

	private rangeContains(
		selection: Extract<GridSelection, { kind: 'range' }>,
		cell: { recordId: string; fieldId: string },
	): boolean {
		const bounds = this.boundsOf(selection);
		if (!bounds) {
			return false;
		}
		const row = this.rowIndex.get(cell.recordId);
		const column = this.columnIndex.get(cell.fieldId);
		if (row === undefined || column === undefined) {
			return false;
		}
		return (
			row >= bounds.top &&
			row <= bounds.bottom &&
			column >= bounds.left &&
			column <= bounds.right
		);
	}

	private showMenu(event: MouseEvent, target: ContextTarget): void {
		showGridContextMenu(event, target, {
			onEditField: (field, at) => this.handlers.onEditField(field, at),
			onDuplicateField: (field) => this.handlers.onDuplicateField(field),
			onDeleteField: (field) => this.handlers.onDeleteField(field),
			onInsertField: (after) => this.handlers.onAddField(after),
			onInsertRecordsBelow: (id, count) =>
				this.handlers.onInsertRecordsBelow(id, count),
			onDuplicateRecords: (ids) => this.handlers.onDuplicateRecords(ids),
			onDeleteRecords: (ids) => this.handlers.onDeleteRecords(ids),
			onSelect: (selection) => this.setSelection(selection),
			onClearRecord: (recordId) => this.handlers.onClearRecord(recordId),
			onClearCells: (recordIds, fields) =>
				this.handlers.onClearCells(recordIds, fields),
			onCopyRange: (recordIds, fields) =>
				this.handlers.onCopyRange(recordIds, fields),
			onPasteInto: (recordIds, fields) => {
				this.handlers.onPasteInto(recordIds, fields);
			},
			onFillRange: (recordIds, fields) =>
				this.fillRange(recordIds, fields),
		});
	}

	private fillRange(recordIds: string[], fields: Field[]): void {
		const top = recordIds[0];
		if (!top || recordIds.length < 2) {
			return;
		}

		for (const field of fillableFields(fields)) {
			const sourceCell = this.cells.get(cellKey(top, field.id));
			const raw = sourceCell?.dataset.value;
			if (raw === undefined) {
				continue;
			}
			const value = deserializeCellValue(raw, field);

			for (const recordId of recordIds.slice(1)) {
				const cell = this.cells.get(cellKey(recordId, field.id));
				if (cell) {
					this.commit(cell, field, recordId, value);
				}
			}
		}
	}

	private beginEdit(
		cell: HTMLElement,
		field: Field,
		recordId: string,
		value: CellValue,
	): void {
		if (cell.hasClass('is-editing')) {
			return;
		}
		// What the cell shows when the edit ends. A commit moves it on, which a multi-select
		// needs: its toggles commit while the panel stays open, and its restore must not undo them.
		let latest = value;
		// A note property holds nothing here, so its editor starts from what the note says:
		// starting blank would let the first keystroke replace a value the reader never saw.
		const startValue =
			field.type === 'noteProp'
				? this.handlers.notePropText(field, recordId).text
				: value;
		let handle: CellEditHandle | null = null;
		handle = beginCellEdit(cell, {
			field,
			value: startValue,
			commit: (next) => {
				latest = next;
				this.commit(cell, field, recordId, next);
			},
			restore: () =>
				renderCellValue(
					cell,
					field,
					latest,
					this.formatter(),
					recordId,
					(path) => this.handlers.onOpenNote(path),
					this.handlers.noteLabelStyle(),
				),
			createOption: (name) => this.handlers.onCreateOption(field, name),
			relationCandidates: () => this.handlers.relationCandidates(field),
			// Only this edit's own end clears the handle: another edit may have taken the cell
			// over. Kept, it leaves `isEditing()` true long after the edit, and a repaint
			// deferred for a linked table is dropped instead of drawn.
			onFinished: () => {
				if (handle !== null && this.openEdit === handle) {
					this.openEdit = null;
				}
			},
		});
		// A null handle means no editor was opened, so the cell is left as it was.
		if (handle !== null) {
			this.openEdit = handle;
		}
	}

	/** A relation reads from another table, which only the view can reach. */
	private formatter(): CellFormatter {
		return (field, value, recordId) => {
			if (field.type === 'relation') {
				return this.handlers.relationText(field, value);
			}
			if (field.type === 'relationBack') {
				return this.handlers.backText(field, recordId);
			}
			if (field.type === 'formula') {
				return this.handlers.formulaText(field, recordId);
			}
			if (field.type === 'rollup') {
				return this.handlers.rollupText(field, recordId);
			}
			if (field.type === 'lookup') {
				return this.handlers.lookupText(field, recordId);
			}
			if (field.type === 'noteProp') {
				return this.handlers.notePropText(field, recordId);
			}
			if (field.type === 'autoNumber') {
				return this.handlers.autoNumberText(field, recordId);
			}
			return {text: formatCell(field, value), broken: 0};
		};
	}

	/** Ends an edit still open, keeping what it holds — its text is not saved yet. */
	commitOpenEdit(): void {
		this.openEdit?.commit();
		this.openEdit = null;
	}

	/** Whether a cell editor is open, so a repaint must wait for it. */
	isEditing(): boolean {
		return this.openEdit !== null;
	}

	// An edit can change the cells beside it — a formula, a lookup, a rollup, a note property, an
	// auto number — and redrawing just those keeps the selection, focus and scroll position.
	repaintCells(
		recordId: string,
		fields: readonly Field[],
		record: LayerRecord,
	): void {
		for (const field of fields) {
			const cell = this.cells.get(cellKey(recordId, field.id));
			if (cell) {
				this.paintCell(cell, field, recordId, record.cells[field.id] ?? '');
			}
		}
	}

	recolorRow(record: LayerRecord): void {
		const row = this.rows.get(record.id);
		if (!row) {
			return;
		}
		const tint = this.handlers.rowColor(record);
		row.toggleClass('is-colored', tint !== null);
		if (tint === null) {
			row.style.removeProperty('--layer-row-tint');
			return;
		}
		row.style.setProperty('--layer-row-tint', tint);
	}

	refillFoot(): void {
		const table = this.table;
		const view = this.view;
		if (!table || !view) {
			return;
		}
		table.tFoot?.remove();
		this.renderFoot(table, this.visible, view, this.shownRows);
	}

	private commit(
		cell: HTMLElement,
		field: Field,
		recordId: string,
		value: CellValue,
	): void {
		this.handlers.onCellCommit(recordId, field, value);
		this.paintCell(cell, field, recordId, value);
	}
}

function cellKey(recordId: string, fieldId: string): string {
	return `${recordId}\u0000${fieldId}`;
}

/** Whether a press landed on a checkbox's box. Walks up: the box holds an `svg`. */
function isCheckboxBox(event: MouseEvent): boolean {
	const target = event.target;
	return (
		target instanceof HTMLElement &&
		target.closest('.layer-grid-checkbox') !== null
	);
}

function isElement(value: HTMLElement | undefined): value is HTMLElement {
	return value !== undefined;
}

/** What a cell reads as, and whether part of it could not be resolved. */
export interface CellText {
	text: string;
	broken: number;
	chips?: readonly string[];
	/** What stands behind the text, so a total can line up and a condition can show a tick. */
	kind?: 'number' | 'text' | 'boolean';
	/** Whether a box drawn for this cell is ticked. Only read when `kind` is boolean. */
	ticked?: boolean;
	/** Why the cell cannot show what it should; shown on hover and read out. */
	hint?: string;
}

/** Resolves a cell to text. A relation needs another table, so the caller supplies it. */
export type CellFormatter = (
	field: Field,
	value: CellValue,
	recordId: string,
) => CellText;

const plainFormatter: CellFormatter = (field, value) => ({
	text: formatCell(field, value),
	broken: 0,
});

/** Draws an already-resolved cell: chips when it holds several values. */
function paintResolved(
	cell: HTMLElement,
	field: Field,
	resolved: CellText,
): void {
	cell.toggleClass('is-broken-reference', resolved.broken > 0);
	// The kind is carried by the cell, so the alignment rule reaches the text.
	cell.toggleClass('is-value-number', resolved.kind === 'number');
	if (resolved.kind === 'boolean') {
		// A condition draws the same box a checkbox column does, rather than TRUE and FALSE.
		const ticked = resolved.ticked === true;
		const box = cell.createSpan({
			cls: ticked ? 'layer-grid-checkbox is-ticked' : 'layer-grid-checkbox',
		});
		setIcon(box, ticked ? 'check-square' : 'square');
		box.setAttribute('aria-label', ticked ? t().cellChecked : t().cellUnchecked);
		return;
	}
	if (resolved.chips && resolved.chips.length > 0) {
		const run = cell.createSpan({cls: 'layer-grid-pills'});
		for (const chip of resolved.chips) {
			renderOptionPill(run, chip, undefined);
		}
	} else {
		cell.createSpan({
			cls:
				field.type === 'longtext'
					? 'layer-grid-value is-longtext'
					: 'layer-grid-value',
			text: resolved.text,
		});
	}
	if (resolved.broken > 0) {
		// The reason travels with the cell, so a hover and a screen reader both get it.
		const why = resolved.hint ?? t().relationBroken;
		cell.setAttribute('aria-label', why);
		// Only when the wording changes: a cell repaints on every scroll, and re-registering the
		// same tooltip each time would pile up handlers.
		if (cell.dataset.hint !== why) {
			cell.dataset.hint = why;
			setTooltip(cell, why);
		}
	}
}

export function renderCellValue(
	cell: HTMLElement,
	field: Field,
	value: CellValue,
	format: CellFormatter = plainFormatter,
	recordId = '',
	onOpenNote?: (path: string) => void,
	noteStyle: NoteLabelStyle = 'name',
): void {
	cell.empty();
	cell.removeClass('is-editing');
	// Cleared on every paint, so a stale warning cannot outlive the value.
	cell.removeClass('is-broken-reference');
	cell.removeClass('is-value-number');
	cell.removeAttribute('aria-label');
	// Recomputed here rather than in `paintCell`, because this is also the restore path.
	cell.toggleClass(
		'is-missing-required',
		isMissingRequired(field, value),
	);
	// Before the empty branch: an unticked box is an empty value, and `—` would say "no data"
	// where the reader needs "not ticked".
	if (field.type === 'checkbox') {
		const ticked = value === true;
		const box = cell.createSpan({
			cls: ticked ? 'layer-grid-checkbox is-ticked' : 'layer-grid-checkbox',
		});
		setIcon(box, ticked ? 'check-square' : 'square');
		box.setAttribute('aria-label', ticked ? t().cellChecked : t().cellUnchecked);
		return;
	}
	// A derived cell stores nothing, so it is answered before the empty branch gives it `—`.
	if (isDerived(field.type)) {
		const resolved = format(field, value, recordId);
		// A computed cell with nothing to show reads like any empty cell: a column with no
		// expression yet, or a reverse relation nobody points at, is empty rather than broken.
		const empty =
			resolved.broken === 0 &&
			resolved.kind !== 'boolean' &&
			resolved.text === '' &&
			(resolved.chips === undefined || resolved.chips.length === 0);
		if (empty) {
			cell.createSpan({cls: 'layer-grid-placeholder', text: '—'});
			return;
		}
		paintResolved(cell, field, resolved);
		return;
	}
	if (isEmptyCell(value)) {
		cell.createSpan({cls: 'layer-grid-placeholder', text: '—'});
		return;
	}
	// A value naming no option is a stale id or a hand-edited file, so it falls through to the
	// plain span below rather than vanishing from the grid.
	if (field.type === 'select') {
		const option = optionForId(field, value);
		if (option) {
			renderOptionPill(cell, option.name, option.color);
			return;
		}
	}
	if (field.type === 'multiSelect') {
		const chosen = optionsOf(field, value);
		if (chosen.length > 0) {
			// One box around the run, so it clips as a whole.
			const run = cell.createSpan({cls: 'layer-grid-pills'});
			for (const option of chosen) {
				renderOptionPill(run, option.name, option.color);
			}
			return;
		}
	}
	// Answered before the plain span at the bottom, which would paint a note path as text.
	if (field.type === 'note' && typeof value === 'string' && value !== '') {
		renderNoteLink(cell, value, noteLabel(value, noteStyle), onOpenNote);
		return;
	}
	// The class on the value is what lets CSS tell the two textual types apart.
	paintResolved(cell, field, format(field, value, recordId));
}

// The anchor is only as wide as its text, so the rest of the cell still selects and edits as any
// cell does; a click on the text opens the note and is kept from the cell underneath.
function renderNoteLink(
	cell: HTMLElement,
	path: string,
	label: string,
	open?: (path: string) => void,
): void {
	const link = cell.createEl('a', {cls: 'layer-grid-note', text: label});
	link.setAttribute('href', '#');
	link.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		open?.(path);
	});
}

/** The option a stored cell value refers to; ids are unique per field. */
function optionForId(field: Field, value: CellValue): SelectOption | undefined {
	return field.options?.find((option) => option.id === value);
}

function renderEmptyState(
	mount: HTMLElement,
	icon: string,
	title: string,
	hint: string,
): void {
	const empty = mount.createDiv({cls: 'layer-grid-empty'});
	const iconEl = empty.createDiv({cls: 'layer-grid-empty-icon'});
	setIcon(iconEl, icon);
	empty.createDiv({cls: 'layer-grid-empty-title', text: title});
	empty.createDiv({cls: 'layer-grid-empty-hint', text: hint});
}

function visibleFields(doc: LayerDoc, view: View): Field[] {
	if (view.hiddenFieldIds.length === 0) {
		return doc.fields;
	}
	const hidden = new Set(view.hiddenFieldIds);
	return doc.fields.filter((f) => !hidden.has(f.id));
}
