import {setIcon} from 'obsidian';
import {t} from '../../i18n';
import {
	HEADER_HEIGHT,
	ROW_NUMBER_COLUMN_WIDTH,
	TAIL_COLUMN_WIDTH,
	columnWidthOf,
	rowHeightOf,
} from '../../model/layout';
import {formatCell, isEmptyCell, specFor} from '../../model/fields';
import type {CellValue, Field, GridView, LayerDoc, View} from '../../types';
import {beginCellEdit} from './cell-editor';
import {attachColumnDrag} from './column-drag';
import {attachRangeDrag, type RangeDragHandle} from './range-drag';
import {
	showGridContextMenu,
	type ContextTarget,
} from './grid-context-menu';
import {attachColumnResize, attachRowResize} from './resize';
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
	onEditField(field: Field): void;
	onAddField(after?: Field): void;
	onDuplicateField(field: Field): void;
	onDeleteField(field: Field): void;
	onClearCells(recordIds: string[], fields: Field[]): void;
	onCopyRange(recordIds: string[], fields: Field[]): void;
	onPasteInto(recordIds: string[], fields: Field[]): void;
	onSelectionChange(
		selection: GridSelection | null,
		range: RangeSize | null,
	): void;
	onColumnResize(fieldId: string, width: number): void;
	onReorderField(fieldId: string, beforeFieldId: string | null): void;
	onRowResize(recordId: string, height: number): void;
}

export class GridRenderer {
	private cells = new Map<string, HTMLElement>();
	private rows = new Map<string, HTMLElement>();
	private rowNumbers = new Map<string, HTMLElement>();
	private headers = new Map<string, HTMLElement>();
	private cols = new Map<string, HTMLTableColElement>();
	private fit: HTMLElement | null = null;
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

	private readonly selection: SelectionTracker;

	constructor(
		private readonly host: HTMLElement,
		private readonly handlers: GridHandlers,
	) {
		this.selection = new SelectionTracker((target) => this.resolve(target));
	}

	render(doc: LayerDoc, view: GridView): void {
		this.host.empty();
		this.host.addClass('layer-grid');
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
		const fit = scroll.createDiv({cls: 'layer-grid-fit'});
		this.fit = fit;
		this.marqueeHost = fit;
		const table = fit.createEl('table', {cls: 'layer-grid-table'});

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
			onEnd: () => {},
		});

		this.renderColgroup(table, fields, view);
		this.renderHead(table, doc, fields, view);
		this.renderBody(table, doc, fields, view);

		this.marquee = fit.createDiv({cls: 'layer-grid-marquee'});

		this.selection.refresh();
	}

	renderedOrder(): { recordIds: string[]; fields: Field[] } {
		return {recordIds: [...this.recordOrder], fields: [...this.visible]};
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
			const icon = th.createSpan({cls: 'layer-grid-type-icon'});
			setIcon(icon, specFor(field.type).icon);
			th.createSpan({cls: 'layer-grid-th-name', text: field.name});

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
				this.handlers.onEditField(field);
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
			this.handlers.onAddField();
		});
	}

	/**
	 * The corner cell: selects everything.
	 *
	 * The same range the mouse would draw from the first cell to the last, so
	 * what gets highlighted afterwards is exactly what a drag over the table
	 * would highlight — the status row, the marquee and the context menu then all
	 * read from it without special-casing a "select all" selection.
	 */
	private renderHeadSelectAll(
		cell: HTMLTableCellElement,
		enabled: boolean,
	): void {
		cell.addClass('layer-grid-th', 'layer-grid-rownum', 'layer-grid-corner');

		const button = cell.createEl('button', {cls: 'layer-grid-select-all'});
		button.setAttribute('aria-label', t().selectAll);
		setIcon(button, 'move-diagonal');
		// Nothing to select on an empty board, and a button that answers the
		// click by doing nothing is worse than one that says it is unavailable.
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
				// The inline width is what the last drag left on screen, which is
				// the size this gesture has to continue from. The document is only
				// the fallback for a column that has not been dragged yet.
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
		// At most one header carries the class at a time: the drop is one gap, and
		// two bars in the same gap read as two separate insertion points.
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

	private renderBody(
		table: HTMLTableElement,
		doc: LayerDoc,
		fields: Field[],
		view: GridView,
	): void {
		const body = table.createTBody();
		// Row numbers, one per field, and the header's trailing add-column cell,
		// which spans the body too.
		const columnCount = fields.length + 2;

		if (doc.records.length === 0) {
			const row = body.insertRow();
			row.addClass('layer-grid-row', 'is-empty');
			const cell = row.insertCell();
			cell.colSpan = columnCount;
			cell.addClass('layer-grid-td', 'layer-grid-empty-cell');
			renderEmptyState(cell, 'inbox', t().gridNoRecords, t().gridNoRecordsHint);
			return;
		}

		for (const [index, record] of doc.records.entries()) {
			const row = body.insertRow();
			row.addClass('layer-grid-row');
			row.dataset.recordId = record.id;
			row.style.height = `${rowHeightOf(view, record.id)}px`;
			this.rows.set(record.id, row);
			this.rowIndex.set(record.id, index);
			this.recordOrder.push(record.id);

			this.renderRowNumber(row, record.id, index + 1, view);

			for (const field of fields) {
				const cell = row.insertCell();
				cell.addClass('layer-grid-td', `is-${field.type}`);
				cell.dataset.fieldId = field.id;
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
		renderCellValue(cell, field, value);
		cell.dataset.value = value;

		cell.onclick = (event) => {
			event.preventDefault();
			if (this.rangeDrag?.consumeStaleClick()) {
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
			onEditField: (field) => this.handlers.onEditField(field),
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

		for (const field of fields) {
			const sourceCell = this.cells.get(cellKey(top, field.id));
			const value = sourceCell?.dataset.value;
			if (value === undefined) {
				continue;
			}

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
		beginCellEdit(cell, {
			field,
			value,
			commit: (next) => this.commit(cell, field, recordId, next),
			restore: () => renderCellValue(cell, field, value),
		});
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

function isElement(value: HTMLElement | undefined): value is HTMLElement {
	return value !== undefined;
}

export function renderCellValue(
	cell: HTMLElement,
	field: Field,
	value: CellValue,
): void {
	cell.empty();
	cell.removeClass('is-editing');
	if (isEmptyCell(value)) {
		cell.createSpan({cls: 'layer-grid-placeholder', text: '—'});
		return;
	}
	cell.createSpan({cls: 'layer-grid-value', text: formatCell(field, value)});
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
