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
	type GridSelection,
	type RangeBounds,
	type RangeSize,
} from './selection';

/**
 * Table rendering, selection and in-place editing for a `.layer` document.
 *
 * Interaction follows the spreadsheet model users already know:
 *
 * - **Single click selects** a cell, or a whole row via its number, or a whole
 *   column via its header.
 * - **Double click edits** the selected cell, and a checkbox toggles on a
 *   single click because that is its whole interaction.
 *
 * Selection never re-renders the table and is never written to the file; editing
 * repaints only the cell that changed, because replacing the DOM around a
 * focused input would drop the caret. `renderCellValue` is the single place that
 * paints a cell, so a repaint and a fresh render always agree.
 *
 * A real `<table>` is used because it gives column alignment and header/scope
 * semantics for free, and Obsidian's own styles target tables.
 */

/** Callbacks the grid needs from its owner. */
export interface GridHandlers {
	/** Persist a new cell value. Called once per committed edit. */
	onCellCommit(recordId: string, field: Field, value: CellValue): void;

	/** Insert blank rows directly below a given one. */
	onInsertRecordsBelow(recordId: string, count: number): void;

	/** Duplicate rows, keeping their cell values. */
	onDuplicateRecords(recordIds: string[]): void;

	/** Remove rows. */
	onDeleteRecords(recordIds: string[]): void;

	/** Clear every cell in a record, keeping the row. */
	onClearRecord(recordId: string): void;

	/** Open the editor for an existing column. */
	onEditField(field: Field): void;

	/** Open the editor for a new column. `after` places it next to its anchor. */
	onAddField(after?: Field): void;

	/** Copy a column's definition, without its values. */
	onDuplicateField(field: Field): void;

	/** Delete a column and its values. */
	onDeleteField(field: Field): void;

	/** Empty every cell of a range. */
	onClearCells(recordIds: string[], fields: Field[]): void;

	/** Copy a range, so it can be pasted back as the same values. */
	onCopyRange(recordIds: string[], fields: Field[]): void;

	/**
	 * Paste into a rectangle, extending it to fit the clipboard.
	 *
	 * The extension is the owner's job: it needs the clipboard's size, which is
	 * only known after an asynchronous read, and the owner already holds the
	 * rendered order that the content must grow into.
	 */
	onPasteInto(recordIds: string[], fields: Field[]): void;

	/** Report the current selection, for the status row. */
	onSelectionChange(
		selection: GridSelection | null,
		range: RangeSize | null,
	): void;

	/** Persist a column's new width. */
	onColumnResize(fieldId: string, width: number): void;

	/** Move a column so it sits immediately before another, or last when null. */
	onReorderField(fieldId: string, beforeFieldId: string | null): void;

	/** Persist a row's new height. */
	onRowResize(recordId: string, height: number): void;
}

export class GridRenderer {
	/**
	 * Element lookup for the current render, used to highlight a selection
	 * without walking the table. Rebuilt on every render because the elements
	 * are new each time.
	 */
	private cells = new Map<string, HTMLElement>();
	private rows = new Map<string, HTMLElement>();
	private rowNumbers = new Map<string, HTMLElement>();
	private headers = new Map<string, HTMLElement>();
	/** The `<col>` behind each field, so a drag can update one width cheaply. */
	private cols = new Map<string, HTMLTableColElement>();
	/** The block that carries the definite width the table fills. */
	private fit: HTMLElement | null = null;
	/** The columns on screen, in order, for mapping a drop to an anchor. */
	private visible: Field[] = [];
	/** Header cells of the add-column cell, the drop target for "move to end". */
	private tailHead: HTMLElement | null = null;
	/** Set while a column drag settles, so the click it ends with is ignored. */
	private ignoreNextColumnClick = false;
	private readonly columnDragTeardowns: (() => void)[] = [];
	/** Rendered order, so a range can be resolved to row and column positions. */
	private rowIndex = new Map<string, number>();
	private columnIndex = new Map<string, number>();
	/** The same order as arrays, for O(1) lookup by position. */
	private recordOrder: string[] = [];
	/** The floating box that outlines a range. */
	private marquee: HTMLElement | null = null;
	/** The element the marquee is positioned against. */
	private marqueeHost: HTMLElement | null = null;
	/** The rectangle drag, replaced on every render along with the table. */
	private rangeDrag: RangeDragHandle | null = null;

	private readonly selection: SelectionTracker;

	constructor(
		private readonly host: HTMLElement,
		private readonly handlers: GridHandlers,
	) {
		this.selection = new SelectionTracker((target) => this.resolve(target));
	}

	/** Renders `doc` using the column set of `view`. */
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
		/*
		 * Reset, not merely declared: rendering appends to this while building
		 * the rows, and without clearing it every render would add another copy
		 * of the same ids. A stale list makes `slice` return the wrong rows,
		 * which is why range actions used to touch only the first column.
		 */
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
		/*
		 * The table sits inside a block whose width this renderer sets explicitly.
		 *
		 * A table's own width is not a reliable way to say "exactly this wide": an
		 * `auto` or `max-content` width is still stretched to the container by the
		 * table sizing rules, and the slack is then shared out among the columns —
		 * which silently resizes the row-number gutter along with everything else.
		 * A block with a definite pixel width has no such rule, so the table can
		 * simply fill it and the declared columns are what decides the result.
		 *
		 * It is also the containing block for the range marquee: the marquee is
		 * positioned in this element's coordinates, so it must be `relative`.
		 */
		const fit = scroll.createDiv({cls: 'layer-grid-fit'});
		this.fit = fit;
		this.marqueeHost = fit;
		const table = fit.createEl('table', {cls: 'layer-grid-table'});

		// Clicking empty space clears the selection, which is how a spreadsheet
		// behaves and gives users a way to deselect.
		scroll.addEventListener('mousedown', (event) => {
			if (event.target === scroll || event.target === fit || event.target === table) {
				this.setSelection(null);
			}
		});

		// One listener for the whole table, rather than a pair per cell.
		this.rangeDrag = attachRangeDrag(table, {
			onStart: (cell) => {
				this.setSelection({kind: 'range', anchor: cell, focus: cell});
			},
			onExtend: (cell) => {
				const current = this.selection.get();
				if (current?.kind !== 'range') {
					return;
				}
				// The anchor stays where the gesture began; only the far end moves.
				this.setSelection({kind: 'range', anchor: current.anchor, focus: cell});
			},
			onEnd: () => {
				// Nothing to persist: a selection is not part of the document.
			},
		});

		this.renderColgroup(table, fields, view);
		this.renderHead(table, fields, view);
		this.renderBody(table, doc, fields, view);

		// Added last so the marquee paints above the cells without needing a
		// higher stacking order than the sticky header.
		this.marquee = fit.createDiv({cls: 'layer-grid-marquee'});

		// The elements are new, so any previous highlight must be re-applied.
		this.selection.refresh();
	}

	/**
	 * The rows and columns on screen, in order.
	 *
	 * Exposed so a paste can be extended into them. The grid is the only thing
	 * that knows the rendered order — the document cannot say which rows a filter
	 * left visible.
	 */
	renderedOrder(): { recordIds: string[]; fields: Field[] } {
		return {recordIds: [...this.recordOrder], fields: [...this.visible]};
	}

	/**
	 * Declares every column's width up front, and the table's total from them.
	 *
	 * A `<colgroup>` is how a table takes explicit column widths: the browser
	 * lays the columns out from these and never from the content, which is what
	 * makes a dragged width stay put. Changing one `<col>` during a drag also
	 * reflows the table without touching a single cell.
	 *
	 * The table's own width is set too. Left to itself a fixed-layout table is
	 * stretched to its container and the slack is shared among the columns, so
	 * every width — including the row-number gutter — would drift.
	 */
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

	/**
	 * Sets the wrapper's width to the sum of its declared columns.
	 *
	 * Read back from the `<col>` elements rather than recomputed from the view,
	 * because a drag changes them before the view is written — during the gesture
	 * the DOM is the only place that knows the current widths.
	 */
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
		fields: Field[],
		view: GridView,
	): void {
		const row = table.createTHead().insertRow();
		// The header matches the data rows, and this is what makes the
		// add-column cell square — its column is the same number wide.
		row.style.height = `${HEADER_HEIGHT}px`;

		row.insertCell().addClass('layer-grid-th', 'layer-grid-rownum');

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
			// A click selects the column; editing a field is deliberate enough
			// to warrant its own target, so double click opens the editor.
			th.addEventListener('click', (event) => {
				event.preventDefault();
				// A drag ends with a click on the header it started from, and that
				// click must not also select the column the user just moved.
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

	/** Adds the drag handle to a header's right edge.
	 *
	 * The drag starts from the width the view says the column has, not from a
	 * measurement: with `table-layout: fixed` the rendered width *is* the
	 * declared width, and reading a rectangle per column would force a layout for
	 * every header during render.
	 */
	private attachColumnResizer(
		th: HTMLElement,
		field: Field,
		view: GridView,
	): void {
		const handle = th.createSpan({cls: 'layer-grid-resizer'});
		attachColumnResize(handle, columnWidthOf(view, field.id), {
			onPreview: (pixels) => {
				const col = this.cols.get(field.id);
				if (col) {
					col.style.width = `${pixels}px`;
				}
				// The table's total must follow, or the columns would be shared
				// out to a total that no longer matches them.
				this.applyTableWidth();
			},
			onCommit: (pixels) => this.handlers.onColumnResize(field.id, pixels),
		});
	}

	/**
	 * Makes a header draggable to reorder its column.
	 *
	 * The header body carries the gesture while the trailing strip resizes, so
	 * the strip's own mousedown stops propagation before it reaches here and the
	 * two never fight over one press.
	 */
	private attachColumnReorder(th: HTMLElement, field: Field): void {
		const teardown = attachColumnDrag(th, field.id, {
			onStart: (fieldId) => {
				this.headers.get(fieldId)?.addClass('is-dragging-column');
			},
			onMove: (fieldId, clientX) => {
				this.showDropTarget(fieldId, clientX);
			},
			onDrop: (fieldId, clientX) => {
				// Set before the reorder so the click that ends the gesture is
				// already accounted for when it arrives.
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

	/** Detaches drags left on headers that are about to be replaced. */
	private disposeColumnDrags(): void {
		for (const teardown of this.columnDragTeardowns.splice(0)) {
			teardown();
		}
	}

	/**
	 * The field the dragged column should be inserted before.
	 *
	 * Decided by comparing the pointer with each visible header's midpoint, so
	 * the answer is "the column whose left half the pointer is over". Null means
	 * past the last column, which appends.
	 *
	 * A field id rather than an index, because the visible columns are not
	 * adjacent in `doc.fields` once any column is hidden. Counting visible slots
	 * would shuffle the hidden ones to the end.
	 */
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

	/** Marks where the drop would land, for feedback during the drag. */
	private showDropTarget(draggedId: string, clientX: number): void {
		this.clearDropTarget();
		const anchor = this.dropAnchorAt(draggedId, clientX);
		if (anchor === null) {
			// Past the last column: the marker belongs on the add-column cell.
			this.tailHead?.addClass('is-drop-before');
			return;
		}
		this.headers.get(anchor)?.addClass('is-drop-before');
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
		// Row numbers + one per field + the trailing add-column cell.
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

			const tail = row.insertCell();
			tail.addClass('layer-grid-td', 'layer-grid-tail');
			this.renderRowAction(tail, record.id);
		}
	}

	/**
	 * The trailing cell's control.
	 *
	 * Its placement is provisional: the row number is being turned into the
	 * primary row affordance, and this is kept until that decision is made.
	 */
	private renderRowAction(cell: HTMLElement, recordId: string): void {
		const button = cell.createEl('button', {cls: 'layer-grid-row-action'});
		button.setAttribute('aria-label', t().deleteRecord);
		setIcon(button, 'x');
		button.addEventListener('click', (event) => {
			event.preventDefault();
			event.stopPropagation();
			this.handlers.onDeleteRecords([recordId]);
		});
	}

	/**
	 * Row number cell.
	 *
	 * Deliberately a plain cell, not a button: the header row and cells are
	 * already the selection surface, and a button here added a focus stop and a
	 * nested hit target without doing anything the row itself does not. A later
	 * feature that needs a control (reorder handle, context menu) can add one.
	 */
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

		// The row-number gutter is the row's handle in a spreadsheet, so its
		// bottom edge resizes the row.
		const handle = cell.createSpan({cls: 'layer-grid-resizer'});
		attachRowResize(handle, rowHeightOf(view, recordId), {
			onPreview: (pixels) => {
				row.style.height = `${pixels}px`;
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

	/**
	 * The size of a range selection, for the status row.
	 *
	 * Measured here because the visible order belongs to the grid: the document
	 * cannot say how many rows a range covers when a filter has hidden some of
	 * them, and the status row is repainted without re-rendering the grid.
	 */
	private selectionSize(selection: GridSelection | null): RangeSize | null {
		if (!selection || selection.kind !== 'range') {
			return null;
		}
		const bounds = this.boundsOf(selection);
		return bounds ? rangeSize(bounds) : null;
	}

	/** Maps a selection to the elements it should highlight. */
	private resolve(selection: GridSelection): HTMLElement[] {
		this.paintMarquee(selection);

		if (selection.kind === 'row') {
			// The whole row, so a row selection is unmistakable.
			return [this.rows.get(selection.recordId)].filter(isElement);
		}
		if (selection.kind === 'column') {
			// Every cell in the column plus its header, so a column selection
			// reads as a vertical band rather than a single lit header.
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

		/*
		 * A range tints every cell it covers, and its border is drawn by the
		 * marquee rather than by the cells. Outlining each cell individually is
		 * what once turned a selected column into a stack of separate boxes.
		 */
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

	/** Resolves a range selection against the currently rendered order. */
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

	/**
	 * Draws or hides the box around a range.
	 *
	 * Measured from the corner cells' rectangles, in the coordinate space of the
	 * wrapper the marquee belongs to. Measuring the corners rather than every cell
	 * keeps it O(1) however large the range is.
	 *
	 * Visibility is a class, not an inline `display`: a theme or a future style
	 * change can then reach it without fighting an inline property. The geometry
	 * stays inline because it genuinely changes with every drag.
	 */
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

		// Obsidian's own helper for values that genuinely change at runtime.
		marquee.setCssProps({
			left: `${firstRect.left - hostRect.left}px`,
			top: `${firstRect.top - hostRect.top}px`,
			width: `${lastRect.right - firstRect.left}px`,
			height: `${lastRect.bottom - firstRect.top}px`,
		});
		marquee.addClass('is-visible');
	}

	/** The rendered cell at a row and column position, if it exists. */
	private cellAt(row: number, column: number): HTMLElement | undefined {
		const recordId = [...this.rowIndex.keys()][row];
		const fieldId = [...this.columnIndex.keys()][column];
		if (recordId === undefined || fieldId === undefined) {
			return undefined;
		}
		return this.cells.get(cellKey(recordId, fieldId));
	}

	/** Paints a value and its select / edit behaviour. */
	private paintCell(
		cell: HTMLElement,
		field: Field,
		recordId: string,
		value: CellValue,
	): void {
		renderCellValue(cell, field, value);
		/*
		 * The stored value, kept beside its rendering.
		 *
		 * Fill down copies a column's top value into the cells below it, and doing
		 * that from the displayed text would mean converting it back — for a select
		 * that is a name lookup that can fail, and a failed lookup used to clear the
		 * cell. Keeping the value itself makes the copy exact, and costs one
		 * attribute on a cell that already carries its field id.
		 */
		cell.dataset.value = value;

		cell.onclick = (event) => {
			event.preventDefault();
			// A drag that selected a rectangle ends with a click on the cell it
			// began at. Honouring that click would collapse the rectangle back to
			// one cell, so it is dropped instead.
			if (this.rangeDrag?.consumeStaleClick()) {
				return;
			}
			// A plain click selects a one-cell range: the same operation as a
			// drag that never moved, rather than a separate kind of selection.
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

	/**
	 * Builds the right-click menu for the current selection.
	 *
	 * Right-clicking inside a range targets the whole range: selecting several
	 * cells is how someone asks for a bulk operation, and answering with a
	 * one-cell menu would ignore what they just did. Right-clicking outside it
	 * selects that cell first, which is the spreadsheet behaviour.
	 */
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

		// Read from the rendered cells rather than from the document: the grid
		// already holds each cell's current value, and the document would have to
		// be searched again for the same information.
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

	/** Whether a cell falls inside a range selection. */
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

	/** Builds the right-click menu for a target and shows it at the pointer. */
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

	/**
	 * Fills each column downwards from that column's own top cell.
	 *
	 * "Fill down" means the top row is the pattern and the rows below repeat it —
	 * per column, not from one cell across every column. Taking the first cell's
	 * value and writing it everywhere was wrong twice over: the second column of a
	 * board usually holds something unrelated, and a text value forced into a
	 * select column failed to parse and cleared the cell instead of leaving it be.
	 *
	 * Because each column fills from itself, every value already belongs to the
	 * type it is written to — there is nothing to convert and nothing to refuse.
	 *
	 * Reads from the rendered cells rather than the document so the values are
	 * exactly what is on screen, and writes through `commit`, the same path an
	 * edit takes, so the display, the document and the save all stay in step.
	 */
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

	/** Applies the edit on screen, then reports it for persistence. */
	private commit(
		cell: HTMLElement,
		field: Field,
		recordId: string,
		value: CellValue,
	): void {
		this.handlers.onCellCommit(recordId, field, value);
		// Repaint through `paintCell` so the handlers close over the new value.
		// Repainting only the text would leave the old closures in place, and the
		// next interaction would act on the previous value — pressing Enter
		// would silently undo the edit, and a checkbox could never be unchecked.
		this.paintCell(cell, field, recordId, value);
	}
}

function cellKey(recordId: string, fieldId: string): string {
	return `${recordId}\u0000${fieldId}`;
}

function isElement(value: HTMLElement | undefined): value is HTMLElement {
	return value !== undefined;
}

/** Renders one cell's display text, or a placeholder when it holds nothing. */
export function renderCellValue(
	cell: HTMLElement,
	field: Field,
	value: CellValue,
): void {
	cell.empty();
	cell.removeClass('is-editing');
	if (isEmptyCell(value)) {
		// A visible placeholder, so an empty cell reads as empty rather than as
		// a cell that failed to render.
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

/** Fields this view shows, honouring the view's hidden-column list. */
function visibleFields(doc: LayerDoc, view: View): Field[] {
	if (view.hiddenFieldIds.length === 0) {
		return doc.fields;
	}
	const hidden = new Set(view.hiddenFieldIds);
	return doc.fields.filter((f) => !hidden.has(f.id));
}
