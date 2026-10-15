import {Notice, TextFileView, type TFile, type WorkspaceLeaf} from 'obsidian';
import {LAYER_EXTENSION, VIEW_TYPE_LAYER} from '../constants';
import {t} from '../i18n';
import {parseLayerDoc, serializeLayerDoc} from '../io/schema';
import type LayerBasePlugin from '../main';
import {
	addField,
	addRecord,
	changeFieldType,
	clearRecord,
	clearCells,
	duplicateField,
	duplicateRecords,
	findRecord,
	insertFieldAfter,
	insertRecordsAfter,
	moveFieldBefore,
	pasteCells,
	pasteFormatted,
	type PasteReport,
	removeField,
	removeRecords,
	setCellValue,
} from '../model/records';
import {copyFormatted, readFormatted, readText} from '../model/clipboard';
import type {FormattedClipboard} from '../model/clipboard';
import {formatGrid, gridShape, parseGrid} from '../model/tsv';
import {cellToText, usesOptions} from '../model/fields';
import {
	findGridView,
	setColumnWidth,
	setRowHeight,
} from '../model/layout';
import type {CellValue, Field, LayerDoc, View} from '../types';
import {generateId} from '../utils/id';
import {ConfirmModal} from '../ui/confirm-modal';
import {FieldEditorModal, type FieldEditorResult} from '../ui/field-editor-modal';
import type {GridSelection, RangeSize} from './grid/selection';
import {BoardShell} from './board-shell';
import {GridRenderer} from './grid/grid-view';

/**
 * The view for one `.layer` file.
 *
 * Inherits `TextFileView` so the file stays ordinary text on disk: that is what
 * makes Obsidian Sync, file history and external editors keep working. Writes go
 * through Obsidian's own save pipeline — mark the doc dirty, let `requestSave()`
 * call `getViewData()` and write it — so the plugin never touches
 * `app.vault.modify` and cannot race with Sync.
 *
 * The one subtlety is the write feedback loop: saving the file makes Obsidian
 * call `setViewData` again with the text this view just produced. Re-parsing
 * that is harmless but re-renders and loses scroll position, so a save is
 * stamped here and the echo is skipped once on the way back in.
 */
export class LayerView extends TextFileView {
	private doc: LayerDoc | null = null;
	/** Set while a save issued by this view is still travelling to the vault. */
	private pendingSelfWrite = false;
	private selfWriteText: string | null = null;
	/** View selected by the user, or null to use the file's default. */
	private activeViewId: string | null = null;
	/** Ephemeral grid selection; never written to the file. */
	private selection: GridSelection | null = null;
	/** Size of the selected range, measured by the grid that rendered it. */
	private rangeSize: RangeSize | null = null;
	/** The renderer for the active table view, kept for the rendered order. */
	private grid: GridRenderer | null = null;
	private statusEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: LayerBasePlugin) {
		super(leaf);
	}

	getViewType(): string {
		return VIEW_TYPE_LAYER;
	}

	getDisplayText(): string {
		return this.file?.basename ?? t().placeholderBoard;
	}

	getIcon(): string {
		return 'layout-grid';
	}

	canAcceptExtension(extension: string): boolean {
		return extension === LAYER_EXTENSION;
	}

	async onLoadFile(file: TFile): Promise<void> {
		// Drop any save queued for the previous file before switching over.
		this.pendingSelfWrite = false;
		this.selfWriteText = null;
		await super.onLoadFile(file);
	}

	/**
	 * Called by Obsidian when it needs the file's text. Returning the serialized
	 * document here is the only write path, which keeps save ordering, Sync and
	 * conflict handling inside Obsidian.
	 */
	getViewData(): string {
		if (!this.doc) {
			return '';
		}
		return serializeLayerDoc(this.doc);
	}

	setViewData(data: string, _clear: boolean): void {
		if (this.pendingSelfWrite && data === this.selfWriteText) {
			// Our own save coming back; the in-memory doc is already current.
			this.pendingSelfWrite = false;
			this.selfWriteText = null;
			return;
		}
		// The file changed from outside (another device, Sync, a hand edit).
		this.pendingSelfWrite = false;
		this.selfWriteText = null;

		const {doc, warnings} = parseLayerDoc(data);
		this.doc = doc;

		if (warnings.length > 0) {
			// Reporting only: do not mark dirty here, or opening a file with one
			// quirk would rewrite it just because it was looked at.
			new Notice(t().noticeParseWarnings(warnings.length));
			console.warn(
				`[obsidian-layer-base] Repaired ${warnings.length} issue(s) while reading "${this.file?.path ?? 'unknown'}":`,
				warnings,
			);
		}

		this.render();
	}

	clear(): void {
		this.doc = null;
		this.pendingSelfWrite = false;
		this.selfWriteText = null;
		this.contentEl.empty();
	}

	async onUnloadFile(file: TFile): Promise<void> {
		// Make sure the last edit reaches the vault before the file is released.
		// `requestSave` is fire-and-forget, so the save itself is not awaited;
		// Obsidian flushes pending saves when the leaf closes.
		this.requestSave();
		await super.onUnloadFile(file);
	}

	/**
	 * Marks the document dirty and asks Obsidian to persist it.
	 *
	 * `requestSave` is already debounced by Obsidian, so cell edits can call
	 * this per keystroke and still produce a single write.
	 */
	markDirty(): void {
		if (!this.doc) {
			return;
		}
		this.pendingSelfWrite = true;
		this.selfWriteText = this.getViewData();
		this.requestSave();
	}

	getDocument(): LayerDoc | null {
		return this.doc;
	}

	setDocument(doc: LayerDoc): void {
		this.doc = doc;
		this.render();
	}

	private render(): void {
		// `contentEl` sits below the view header that Obsidian draws (breadcrumb,
		// navigation, the ⋮ menu). Rendering into `containerEl` instead would
		// wipe that header out, which is why this view had none.
		this.contentEl.empty();
		this.contentEl.addClass('layer-base-container');

		if (!this.doc) {
			this.renderMessage(t().emptyFile);
			return;
		}

		const view = this.activeView();
		if (!view) {
			this.renderMessage(t().emptyFile);
			return;
		}

		const shell = new BoardShell(this.contentEl, {
			onSelectView: (viewId) => {
				this.activeViewId = viewId;
				this.render();
			},
			onAddRecord: () => {
				this.handleAddRecord();
			},
		});
		// Top to bottom: actions on the data, then the projection of it, then a
		// read-only summary.
		shell.renderToolbar();
		shell.renderTabs({
			views: this.doc.views,
			activeViewId: view.id,
		});

		const mount = this.contentEl.createDiv({ cls: 'layer-base-view' });
		if (view.type === 'grid') {
			// Kept so clipboard actions can ask the grid for the rendered order,
			// which they need to extend a paste. Asking through a callback would
			// mean calling into an object still being constructed here.
			const grid = new GridRenderer(mount, {
				onCellCommit: (recordId, field, value) => {
					this.handleCellCommit(recordId, field, value);
				},
				onDeleteRecords: (recordIds) => {
					this.handleDeleteRecords(recordIds);
				},
				onInsertRecordsBelow: (recordId, count) => {
					this.handleInsertRecordsBelow(recordId, count);
				},
				onDuplicateRecords: (recordIds) => {
					this.handleDuplicateRecords(recordIds);
				},
				onEditField: (field) => {
					this.openFieldEditor(field);
				},
				onAddField: (after) => {
					this.openFieldEditor(null, after);
				},
				onDuplicateField: (field) => {
					this.handleDuplicateField(field);
				},
				onDeleteField: (field) => {
					this.handleDeleteField(field);
				},
				onClearRecord: (recordId) => {
					this.handleClearRecord(recordId);
				},
				onCopyRange: (recordIds, fields) => {
					void this.handleCopy(recordIds, fields);
				},
				onPasteInto: (recordIds, fields) => {
					void this.handlePaste(recordIds, fields);
				},
				onClearCells: (recordIds, fields) => {
					this.handleClearCells(recordIds, fields);
				},
				onSelectionChange: (selection, range) => {
					this.selection = selection;
					this.rangeSize = range;
					this.updateStatusBar();
				},
				onColumnResize: (fieldId, width) => {
					this.handleColumnResize(fieldId, width);
				},
				onReorderField: (fieldId, beforeFieldId) => {
					this.handleReorderField(fieldId, beforeFieldId);
				},
				onRowResize: (recordId, height) => {
					this.handleRowResize(recordId, height);
				},
			});
			this.grid = grid;
			grid.render(this.doc, view);
		} else {
			this.grid = null;
			// Board rendering is M3; the tab still switches so the view exists.
			const box = mount.createDiv({ cls: 'layer-base-message' });
			box.setText(t().gridNotImplemented);
		}

		this.renderStatus(shell);
	}

	/** Status row: what is on screen, and what is selected. */
	private renderStatus(shell: BoardShell): void {
		const doc = this.doc;
		const view = this.activeView();
		if (!doc || !view) {
			return;
		}
		const columns = view.type === 'grid' ? this.visibleColumnCount(view) : null;

		this.statusEl = shell.renderStatusBar({
			recordCount: doc.records.length,
			columnCount: columns,
			selectionLabel: this.selectionLabel(),
		});
	}

	/** Paints just the status text, so selecting does not rebuild the grid. */
	private updateStatusBar(): void {
		const label = this.statusEl?.querySelector('.layer-shell-selection');
		if (label) {
			label.setText(this.selectionLabel());
		}
	}

	/**
	 * What the status row says about the selection.
	 *
	 * A single cell reports both coordinates, because "which cell" is only
	 * answerable with both. A rectangle reports its size, which is the thing that
	 * matters once more than one cell is involved. A row or column reports the one
	 * axis it covers — repeating the other would be noise, since a row spans every
	 * column by definition.
	 *
	 * The size is not recomputed here: the visible order belongs to the grid, so
	 * the grid measures the range and hands the figures over.
	 */
	private selectionLabel(): string {
		const selection = this.selection;
		const doc = this.doc;
		if (!selection || !doc) {
			return '';
		}

		if (selection.kind === 'row') {
			const index = rowIndexOf(doc, selection.recordId);
			return index === -1 ? '' : t().selectionRow(index + 1);
		}

		if (selection.kind === 'column') {
			const field = doc.fields.find((f) => f.id === selection.fieldId);
			return field ? t().selectionColumn(field.name) : '';
		}

		const { anchor, focus } = selection;
		if (anchor.recordId === focus.recordId && anchor.fieldId === focus.fieldId) {
			const index = rowIndexOf(doc, anchor.recordId);
			const field = doc.fields.find((f) => f.id === anchor.fieldId);
			if (index === -1 || !field) {
				return '';
			}
			return t().selectionCell(index + 1, field.name);
		}

		const size = this.rangeSize;
		if (!size) {
			return '';
		}
		return t().selectionRange(size.rows, size.columns);
	}

	private visibleColumnCount(view: View): number {
		if (!this.doc) {
			return 0;
		}
		const hidden = new Set(view.hiddenFieldIds);
		return this.doc.fields.filter((f) => !hidden.has(f.id)).length;
	}

	/** Appends a row and re-renders so it appears immediately. */
	private handleAddRecord(): void {
		if (!this.doc) {
			return;
		}
		addRecord(this.doc);
		this.markDirty();
		// Safe to rebuild: no cell editor is open while the add button is used.
		this.render();
	}

	/**
	 * Opens the add/edit field dialog and applies the result.
	 *
	 * `after` places a new column directly after an existing one; without it the
	 * column is appended. "Insert after this column" has to land where the user
	 * was looking, which on a wide board is rarely the far right.
	 */
	private openFieldEditor(field: Field | null, after?: Field): void {
		if (!this.doc) {
			return;
		}
		new FieldEditorModal({
			app: this.app,
			field,
			onSubmit: (result) => {
				this.applyFieldEdit(field, result, after);
			},
		}).open();
	}

	private applyFieldEdit(
		field: Field | null,
		result: FieldEditorResult,
		after?: Field,
	): void {
		const doc = this.doc;
		if (!doc) {
			return;
		}

		if (field === null) {
			const created: Field = {
				id: generateId('f'),
				name: result.name,
				type: result.type,
				options: usesOptions(result.type) ? result.options : undefined,
			};
			if (after) {
				insertFieldAfter(doc, after.id, created);
			} else {
				addField(doc, created);
			}
		} else {
			field.name = result.name;
			if (usesOptions(result.type)) {
				field.options = result.options;
			}
			if (result.typeChanged) {
				// Conversion drops values with no meaning in the new type; the
				// count is surfaced instead of being swallowed.
				const dropped = changeFieldType(doc, field.id, result.type);
				if (dropped > 0) {
					new Notice(t().fieldConverted(dropped));
				}
			}
		}

		this.markDirty();
		this.render();
	}

	/**
	 * Removes the selected rows.
	 *
	 * A selection of three rows deletes three rows, which is what the menu's
	 * title promises. Deleting several asks first: a single row is easy to notice
	 * and undo by hand, while a block of them is not.
	 */
	private handleDeleteRecords(recordIds: string[]): void {
		const doc = this.doc;
		if (!doc || recordIds.length === 0) {
			return;
		}
		if (recordIds.length === 1) {
			if (removeRecords(doc, recordIds) === 0) {
				return;
			}
			this.markDirty();
			this.render();
			return;
		}

		new ConfirmModal(this.app, {
			title: t().menuDeleteRow,
			message: t().recordsDeleteConfirm(recordIds.length),
			confirmText: t().menuDeleteRow,
			onConfirm: () => {
				if (removeRecords(doc, recordIds) === 0) {
					return;
				}
				this.markDirty();
				this.render();
			},
		}).open();
	}

	/** Inserts as many blank rows as were asked for, below the given one. */
	private handleInsertRecordsBelow(recordId: string, count: number): void {
		if (!this.doc || count < 1) {
			return;
		}
		insertRecordsAfter(this.doc, recordId, count);
		this.markDirty();
		this.render();
	}

	/** Copies the selected rows, each copy landing below its source. */
	private handleDuplicateRecords(recordIds: string[]): void {
		if (!this.doc || duplicateRecords(this.doc, recordIds) === 0) {
			return;
		}
		this.markDirty();
		this.render();
	}

	/**
	 * Persists a column's new width.
	 *
	 * Only the document is touched: the drag already resized the `<col>`, so
	 * re-rendering here would rebuild the whole table just to draw the width it
	 * is already showing.
	 */
	private handleColumnResize(fieldId: string, width: number): void {
		const doc = this.doc;
		const view = doc ? findGridView(doc, this.activeView()?.id ?? '') : null;
		if (!view) {
			return;
		}
		setColumnWidth(view, fieldId, width);
		this.markDirty();
	}

	/**
	 * Moves a column to a new position.
	 *
	 * Re-renders rather than shuffling cells: the columns are in a different
	 * order, so every row's cells move too, and rebuilding is both simpler and
	 * correct. No editor can be open while a header is being dragged.
	 */
	private handleReorderField(
		fieldId: string,
		beforeFieldId: string | null,
	): void {
		if (!this.doc) {
			return;
		}
		if (!moveFieldBefore(this.doc, fieldId, beforeFieldId)) {
			return;
		}
		this.markDirty();
		this.render();
	}

	/** Persists a row's new height. The row already shows it. */
	private handleRowResize(recordId: string, height: number): void {
		const doc = this.doc;
		const view = doc ? findGridView(doc, this.activeView()?.id ?? '') : null;
		if (!view) {
			return;
		}
		setRowHeight(view, recordId, height);
		this.markDirty();
	}

	/**
	 * Copies a rectangle.
	 *
	 * Two things are written, and both are needed. The system clipboard receives
	 * tab-separated text, so the copy is usable in any other application. Beside
	 * it, in memory, the payload records each value's type and its stored form —
	 * without it a paste could only guess, and a select would arrive as whatever
	 * its option was called.
	 *
	 * A single cell is a 1x1 rectangle, so there is no separate path for it.
	 */
	private async handleCopy(recordIds: string[], fields: Field[]): Promise<void> {
		const doc = this.doc;
		if (!doc) {
			return;
		}
		const records = recordIds.map((id) => findRecord(doc, id));
		const payload: FormattedClipboard = {
			text: formatGrid(
				records.map((record) =>
					fields.map((field) => cellToText(field, record?.cells[field.id] ?? '')),
				),
			),
			rows: records.map((record) =>
				fields.map((field) => {
					const value = record?.cells[field.id] ?? '';
					return {
						type: field.type,
						value,
						// Kept beside the value so a select can be resolved by name
						// when it lands in another column.
						text: cellToText(field, value),
					};
				}),
			),
		};
		await copyFormatted(payload);
		new Notice(t().noticeCopied);
	}

	/**
	 * The rows and columns currently on screen, in order.
	 *
	 * Delegated to the grid because only it knows what was rendered: a paste must
	 * extend into the visible rows, not into rows a filter has hidden.
	 */
	private renderedOrder(): { recordIds: string[]; fields: Field[] } {
		return this.grid?.renderedOrder() ?? { recordIds: [], fields: [] };
	}

	/**
	 * Grows the selected rectangle to fit the clipboard, as a spreadsheet does.
	 *
	 * A paste starts at the selection's top-left corner and extends to fit the
	 * content. Clipping the content to the selection instead would make pasting a
	 * 2x2 block into one selected cell write a single value and silently drop
	 * three — which is not a smaller version of the operation, it is a different
	 * one.
	 *
	 * The ordered list comes from the grid because the extension must follow the
	 * *rendered* rows: content must not spill into a row a filter has hidden.
	 * Returns null when the content runs past the end of the table, which is
	 * refused rather than partly applied.
	 */
	private growToFit(
		recordIds: string[],
		fields: Field[],
		height: number,
		width: number,
		order: { recordIds: string[]; fields: Field[] },
	): { recordIds: string[]; fields: Field[] } | null {
		const firstRow = recordIds[0];
		const firstField = fields[0];
		if (!firstRow || !firstField) {
			return null;
		}
		const top = order.recordIds.indexOf(firstRow);
		const left = order.fields.findIndex((f) => f.id === firstField.id);
		if (top === -1 || left === -1) {
			return null;
		}

		const grownRows = order.recordIds.slice(top, top + height);
		const grownFields = order.fields.slice(left, left + width);
		if (grownRows.length < height || grownFields.length < width) {
			return null;
		}
		return { recordIds: grownRows, fields: grownFields };
	}

	/**
	 * Pastes the clipboard, starting at the selection's top-left corner.
	 *
	 * One command, because that is what a paste is: what is on the clipboard
	 * decides how it is read, not a choice made beforehand. Excel's extra paste
	 * modes are variations on this one and are not built yet.
	 *
	 * There are two cases and they cannot be merged, because the clipboard really
	 * does hold two different things depending on where the copy came from:
	 *
	 * - **Our own copy**, recognised by the structured payload written beside the
	 *   text. Values are restored exactly and a column of another type refuses
	 *   them, so a select cannot silently become text.
	 * - **Text from anywhere else**, which is all the system clipboard can offer.
	 *   Each value is read by the column it lands in.
	 *
	 * Either way the rectangle grows to fit the content, so pasting a block into
	 * one selected cell fills the block rather than one cell of it.
	 */
	private async handlePaste(recordIds: string[], fields: Field[]): Promise<void> {
		const doc = this.doc;
		if (!doc) {
			return;
		}

		const payload = await readFormatted();
		if (payload) {
			const width = payload.rows.reduce(
				(widest, row) => Math.max(widest, row.length),
				0,
			);
			const target = this.growToFit(
				recordIds,
				fields,
				payload.rows.length,
				width,
				this.renderedOrder(),
			);
			if (!target) {
				new Notice(t().noticePasteNoRoom);
				return;
			}
			this.reportPaste(
				pasteFormatted(doc, target.recordIds, target.fields, payload.rows),
				t().noticePasteTypesMismatch,
			);
			return;
		}

		const text = await readText();
		if (text === null) {
			new Notice(t().noticeNothingToPaste);
			return;
		}
		const rows = parseGrid(text);
		const shape = gridShape(rows);
		const target = this.growToFit(
			recordIds,
			fields,
			shape.rows,
			shape.columns,
			this.renderedOrder(),
		);
		if (!target) {
			new Notice(t().noticePasteNoRoom);
			return;
		}
		this.reportPaste(
			pasteCells(doc, target.recordIds, target.fields, rows),
			t().noticePasteFailed,
		);
	}

	/**
	 * Reports what a paste did, and repaints only when it changed something.
	 *
	 * Shared by both cases so the partial-success message cannot drift between
	 * them: a paste that filled four cells and refused two must say so whichever
	 * kind of clipboard it came from.
	 */
	private reportPaste(report: PasteReport, emptyMessage: string): void {
		if (report.written === 0) {
			new Notice(emptyMessage);
			return;
		}
		if (report.refused > 0) {
			new Notice(t().noticePastePartial(report.written, report.refused));
		}
		this.markDirty();
		this.render();
	}

	/** Empties the selected rectangle. */
	private handleClearCells(recordIds: string[], fields: Field[]): void {
		const doc = this.doc;
		if (!doc) {
			return;
		}
		if (clearCells(doc, recordIds, fields) === 0) {
			return;
		}
		this.markDirty();
		this.render();
	}

	/** Empties a row's cells but keeps the row itself. */
	private handleClearRecord(recordId: string): void {
		if (!this.doc) {
			return;
		}
		if (clearRecord(this.doc, recordId)) {
			this.markDirty();
			this.render();
		}
	}

	/** Copies a column's definition without its values. */
	private handleDuplicateField(field: Field): void {
		if (!this.doc) {
			return;
		}
		if (duplicateField(this.doc, field.id)) {
			this.markDirty();
			this.render();
		}
	}

	private handleDeleteField(field: Field): void {
		const doc = this.doc;
		if (!doc) {
			return;
		}
		const affected = doc.records.filter((r) => field.id in r.cells).length;
		new ConfirmModal(this.app, {
			title: t().fieldDelete,
			message: t().fieldDeleteConfirm(field.name, affected),
			confirmText: t().fieldDelete,
			onConfirm: () => {
				if (removeField(doc, field.id)) {
					this.markDirty();
					this.render();
				}
			},
		}).open();
	}

	/**
	 * Applies an edit to the in-memory document and asks Obsidian to persist it.
	 *
	 * `requestSave()` reads back through `getViewData()`, so updating the
	 * document is all that is required to make the change durable. Obsidian
	 * debounces the actual write, which is what keeps typing from hitting the
	 * disk on every keystroke.
	 */
	private handleCellCommit(
		recordId: string,
		field: Field,
		value: CellValue,
	): void {
		if (!this.doc) {
			return;
		}
		if (!setCellValue(this.doc, recordId, field, value)) {
			// The row disappeared while the editor was open; re-render so the
			// table matches the document instead of showing a phantom row.
			console.warn(
				`[obsidian-layer-base] Edit ignored for a record that no longer exists: ${recordId}`,
			);
			this.render();
			return;
		}
		this.markDirty();
	}

	/**
	 * The view to render for this file.
	 *
	 * The selected tab wins. Without a selection the first table view is used,
	 * falling back to whatever the file has first, so opening a file lands on
	 * something renderable rather than an arbitrary view.
	 */
	private activeView(): View | null {
		if (!this.doc || this.doc.views.length === 0) {
			return null;
		}
		if (this.activeViewId) {
			const selected = this.doc.views.find((v) => v.id === this.activeViewId);
			if (selected) {
				return selected;
			}
			// The view was deleted from the file while it was selected.
			this.activeViewId = null;
		}
		return this.doc.views.find((v) => v.type === 'grid') ?? this.doc.views[0] ?? null;
	}

	private renderMessage(text: string): void {
		const box = this.contentEl.createDiv({ cls: 'layer-base-message' });
		box.setText(text);
	}
}

/** 1-based position of a record, or -1 when it is gone. */
function rowIndexOf(doc: LayerDoc, recordId: string): number {
	return doc.records.findIndex((r) => r.id === recordId);
}

export function createLayerView(
	leaf: WorkspaceLeaf,
	plugin: LayerBasePlugin,
): LayerView {
	return new LayerView(leaf, plugin);
}
