import {Notice, TextFileView, type TFile, type WorkspaceLeaf} from 'obsidian';
import {LAYER_EXTENSION, VIEW_TYPE_LAYER} from '../constants';
import {t} from '../i18n';
import {parseLayerDoc, serializeLayerDoc} from '../io/schema';
import type LayerBasePlugin from '../main';
import {
	addField,
	addRecord,
	addRecordAtTop,
	changeFieldType,
	clearRecord,
	clearCells,
	clearFieldCells,
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
import {appendOption} from '../model/select-options';
import {cellToText, relationIds, usesOptions} from '../model/fields';
import {
	relationBackIndex,
	relationCandidates as candidatesOf,
	relationText as textOf,
	repairRelationPaths,
	type RelationCandidate,
} from '../model/relation';import {
	findGridView,
	setColumnWidth,
	setRowHeight,
} from '../model/layout';
import type {CellValue, Field, LayerDoc, SelectOption, View} from '../types';
import {generateId} from '../utils/id';
import {ConfirmModal} from '../ui/confirm-modal';
import type { Anchor } from '../ui/anchored-popover';
import {
	FieldEditorModal,
	type BackSettings,
	type FieldEditorResult,
	type NumberSettings,
	type RelationSettings,
} from '../ui/field-editor-modal';
import type {GridSelection, RangeSize} from './grid/selection';
import {BoardShell} from './board-shell';
import {GridRenderer, type CellText} from './grid/grid-view';

export class LayerView extends TextFileView {
	private doc: LayerDoc | null = null;
	private pendingSelfWrite = false;
	private activeViewId: string | null = null;
	private selection: GridSelection | null = null;
	private rangeSize: RangeSize | null = null;
	private grid: GridRenderer | null = null;
	/** Reverse lookups for the current render pass, per source column. */
	private readonly backIndexes = new Map<
		string,
		Map<string, string[]> | null
	>();
	/** A repaint is already scheduled, so a burst of changes paints once. */
	private repaintQueued = false;
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
		this.pendingSelfWrite = false;
		await super.onLoadFile(file);
	}

	onload(): void {
		super.onload();
		/*
		 * The last edit has to survive the app closing.
		 *
		 * A save is debounced by two seconds (see `TextFileView.requestSave`), so a
		 * change made just before quitting is still waiting when the app tears
		 * down — and an editor that is still open is worse off, because its
		 * contents have not reached the document at all. Obsidian hands the quit
		 * event a task list it waits for, which is the only place a write can be
		 * finished at that point.
		 */
		this.registerEvent(
			this.app.workspace.on('quit', (tasks) => {
				tasks.add(async () => {
					this.commitOpenEdit();
					// Never saved with no document: `getViewData` answers an empty
					// string there, and writing that would empty the file.
					if (this.doc) {
						await this.save();
					}
				});
			}),
		);
		// A linked table arriving or changing has to reach the cells that read it.
		this.register(this.plugin.tables.onChange(() => this.onTargetLoaded()));
		// A rename carries the exact old-and-new pair, which is the only way to
		// follow a table that was renamed rather than merely moved.
		this.register(
			this.plugin.tables.onRename((oldPath, newPath) =>
				this.repairLinks(oldPath, newPath),
			),
		);
	}

	/** Rewrites this document's links to a table that was renamed or moved. */
	private repairLinks(oldPath: string, newPath: string): void {
		if (!this.doc) {
			return;
		}
		if (repairRelationPaths(this.doc, oldPath, newPath) > 0) {
			this.markDirty();
		}
	}

	/**
	 * Ends an edit still open in a cell, keeping what it holds.
	 *
	 * The editor's contents live in a DOM input until they are committed, so
	 * tearing the view down without this drops the last thing typed.
	 */
	private commitOpenEdit(): void {
		this.grid?.commitOpenEdit();
	}

	/**
	 * The base class "saves any unsaved changes first", so the pending write is
	 * flushed here — but only after an open editor has been committed, or the
	 * value being flushed would not include it.
	 */
	async onUnloadFile(file: TFile): Promise<void> {
		this.commitOpenEdit();
		await super.onUnloadFile(file);
	}

	getViewData(): string {
		if (!this.doc) {
			return '';
		}
		return serializeLayerDoc(this.doc);
	}

	setViewData(data: string, _clear: boolean): void {
		if (this.pendingSelfWrite) {
			this.pendingSelfWrite = false;
			return;
		}

		const {doc, warnings} = parseLayerDoc(data);
		this.doc = doc;

		if (warnings.length > 0) {
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
		this.contentEl.empty();
	}

	markDirty(): void {
		if (!this.doc) {
			return;
		}
		this.pendingSelfWrite = true;
		this.requestSave();
	}

	getDocument(): LayerDoc | null {
		return this.doc;
	}

	private render(): void {
		// The reverse lookups belong to the tree about to be thrown away.
		this.backIndexes.clear();
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
			onAddRecordAtTop: () => {
				this.handleAddRecordAtTop();
			},
		});
		// Top to bottom: actions on the data, then the projection of it, then a
		// read-only summary.
		shell.renderToolbar();		shell.renderTabs({
			views: this.doc.views,
			activeViewId: view.id,
		});

		const mount = this.contentEl.createDiv({ cls: 'layer-base-view' });
		if (view.type === 'grid') {
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
				onEditField: (field, at) => {
					// Keyboard activation gives no coordinates; the column header
					// stands in as the anchor.
					const el = this.grid?.headerFor(field.id) ?? null;
					const anchor: Anchor | null = at
						? { kind: 'point', x: at.x, y: at.y }
						: el
							? { kind: 'element', el }
							: null;
					this.openFieldEditor(field, undefined, anchor);
				},
				onAddField: (after, anchor) => {
					this.openFieldEditor(null, after, anchor ? { kind: 'element', el: anchor } : null);
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
				onCreateOption: (field, name) =>
					this.handleCreateOption(field, name),
				relationCandidates: (field) =>
					this.relationCandidates(field),
				relationText: (field, value) => this.relationText(field, value),
				backText: (field, recordId) => this.backText(field, recordId),
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
		this.render();
	}

	/** Inserts a row above everything else. */
	private handleAddRecordAtTop(): void {
		if (!this.doc) {
			return;
		}
		addRecordAtTop(this.doc);
		this.markDirty();
		this.render();
	}

	private openFieldEditor(
		field: Field | null,
		after?: Field,
		anchor?: Anchor | null,
	): void {
		if (!this.doc) {
			return;
		}
		new FieldEditorModal({
			app: this.app,
			field,
			anchor: anchor ?? null,
			tables: this.plugin.tables,
			selfFields: this.doc.fields,
			selfPath: this.file?.path ?? '',
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
			if (result.required) {
				created.required = true;
			}
			this.applyNumberSettings(created, result.number);
			this.applyRelationSettings(doc, created, result.relation);
				this.applyBackSettings(created, result.back);
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
			// Removed rather than set to false, so a cleared checkbox leaves no
			// dead key behind in the file.
			if (result.required) {
				field.required = true;
			} else {
				delete field.required;
			}
			if (result.typeChanged) {
				const dropped = changeFieldType(doc, field.id, result.type);
				if (dropped > 0) {
					new Notice(t().fieldConverted(dropped));
				}
			}
			// After the type change, which clears these when the field stops being
			// a number.
			this.applyNumberSettings(field, result.number);
			this.applyRelationSettings(doc, field, result.relation);
				this.applyBackSettings(field, result.back);
		}

		this.markDirty();
		this.render();
	}

	/**
	 * Writes the relation's source, keeping "this table" out of the file entirely.
	 *
	 * Pointing the field at a different table or column clears the cells it held:
	 * the stored row ids no longer mean what they did, and carrying them over
	 * would show one column's values where another was asked for. Same rule as
	 * changing a field's type.
	 */
	private applyRelationSettings(
		doc: LayerDoc,
		field: Field,
		settings: RelationSettings,
	): void {
		const wasRelation = field.type === 'relation';
		const beforePath = field.linkPath ?? '';
		const beforeColumn = field.linkFieldId ?? '';

		if (field.type !== 'relation') {
			delete field.linkPath;
			delete field.linkFieldId;
		} else if (settings.path === '') {
			delete field.linkPath;
		} else {
			field.linkPath = settings.path;
		}
		if (field.type === 'relation') {
			if (settings.fieldId === '') {
				delete field.linkFieldId;
			} else {
				field.linkFieldId = settings.fieldId;
			}
		}

		const movedTarget =
			wasRelation &&
			(beforePath !== (field.linkPath ?? '') ||
				beforeColumn !== (field.linkFieldId ?? ''));
		if (!movedTarget) {
			return;
		}
		const cleared = clearFieldCells(doc, field.id);
		if (cleared > 0) {
			new Notice(t().fieldLinkCleared(cleared));
		}
	}

	/**
	 * Writes a reverse relation's source. It stores no values, so there are no
	 * cells to clear when the source changes — only the flag it cannot carry.
	 */
	private applyBackSettings(
		field: Field,
		settings: BackSettings,
	): void {
		if (field.type !== 'relationBack') {
			delete field.backPath;
			delete field.backFieldId;
			delete field.backTitleFieldId;
			return;
		}
		if (settings.path === '') {
			delete field.backPath;
		} else {
			field.backPath = settings.path;
		}
		if (settings.fieldId === '') {
			delete field.backFieldId;
		} else {
			field.backFieldId = settings.fieldId;
		}
		if (settings.titleFieldId === '') {
			delete field.backTitleFieldId;
		} else {
			field.backTitleFieldId = settings.titleFieldId;
		}
		// Derived, so it holds nothing and cannot be required.
		delete field.required;
	}

	/** Writes the number settings, keeping only those that differ from defaults. */
	private applyNumberSettings(field: Field, settings: NumberSettings): void {
		if (field.type !== 'number') {
			delete field.numberFormat;
			delete field.decimals;
			delete field.min;
			delete field.max;
			return;
		}
		if (settings.format === 'percent') {
			field.numberFormat = 'percent';
		} else {
			delete field.numberFormat;
		}
		if (settings.decimals === null) {
			delete field.decimals;
		} else {
			field.decimals = settings.decimals;
		}
		if (settings.min === null) {
			delete field.min;
		} else {
			field.min = settings.min;
		}
		if (settings.max === null) {
			delete field.max;
		} else {
			field.max = settings.max;
		}
	}

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

	private handleColumnResize(fieldId: string, width: number): void {
		const doc = this.doc;
		const view = doc ? findGridView(doc, this.activeView()?.id ?? '') : null;
		if (!view) {
			return;
		}
		setColumnWidth(view, fieldId, width);
		this.markDirty();
	}

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
	 */
	private renderedOrder(): { recordIds: string[]; fields: Field[] } {
		return this.grid?.renderedOrder() ?? { recordIds: [], fields: [] };
	}

	/**
	 * Grows the selected rectangle to fit the clipboard, as a spreadsheet does.
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
	 * Creates a select option from a name typed into a cell, and hands it back so
	 * the cell can be set to it.
	 *
	 * Nothing else is written here on purpose: the cell editor drives the value
	 * through the usual `onCellCommit` path after this returns, so the option
	 * exists before the value that names it. `markDirty` only schedules a save —
	 * it does not re-render — and the commit that follows edits the same
	 * in-memory document. The name arrives already trimmed and non-empty; the
	 * dropdown only offers to create when there is something to create.
	 */
	private handleCreateOption(field: Field, name: string): SelectOption | null {
		const doc = this.doc;
		if (!doc) {
			return null;
		}
		// Re-resolved by id rather than trusted: the grid was built from an
		// earlier render, and the caller's field may be a stale copy.
		const target = doc.fields.find((candidate) => candidate.id === field.id);
		if (!target) {
			return null;
		}
		const option = appendOption(target, name);
		this.markDirty();
		return option;
	}

	/**
	 * The document a relation field reads, or null while it is not to hand.
	 *
	 * A field with no path links to this table; anything else goes through the
	 * vault index, which is also what a renamed table is found by. A miss is not
	 * an error: the index is asked to read it, and the repaint that follows a
	 * finished read is what fills the cell in.
	 */
	private targetDoc(field: Field): LayerDoc | null {
		const path = field.linkPath;
		if (!path) {
			return this.doc;
		}
		const resolved = this.plugin.tables.resolve(path);
		if (!resolved) {
			return null;
		}
		if (resolved !== path) {
			/*
			 * The table was renamed or moved and found again by its filename. The
			 * correction is kept on the field, so the next save of THIS document
			 * writes it down — the plugin never writes a file it was not asked to
			 * edit, and that is the only way the repair reaches the disk.
			 *
			 * Mutating during a paint is safe here: the value it would repaint is
			 * unchanged, so no second render is asked for.
			 */
			field.linkPath = resolved;
			this.markDirty();
		}
		const target = this.plugin.tables.get(resolved);
		if (!target) {
			this.plugin.tables.ensure(resolved);
		}
		return target;
	}

	/**
	 * A linked table finished loading or changed: paint again, once.
	 *
	 * Several tables can land together, and a repaint while a cell is open would
	 * throw the editor away, so the work is deferred and coalesced — a burst of
	 * changes costs one render rather than one each.
	 */
	private onTargetLoaded(): void {
		if (this.grid?.isEditing() || this.repaintQueued) {
			return;
		}
		this.repaintQueued = true;
		window.setTimeout(() => {
			this.repaintQueued = false;
			this.render();
		}, 0);
	}

	private relationCandidates(field: Field): readonly RelationCandidate[] {
		const target = this.targetDoc(field);
		return target ? candidatesOf(target, field.linkFieldId ?? '') : [];
	}

	private relationText(field: Field, value: CellValue): CellText {
		const target = this.targetDoc(field);
		if (!target) {
			return { text: '', broken: relationIds(value).length };
		}
		const resolved = textOf(target, field.linkFieldId ?? '', value);
		return {
			text: resolved.texts.join(', '),
			broken: resolved.broken,
			chips: resolved.texts,
		};
	}

	/** What a reverse relation row shows: the rows elsewhere that point at it. */
	private backText(field: Field, recordId: string): CellText {
		const source = this.sourceDoc(field);
		if (source === null) {
			return { text: '', broken: 1 };
		}
		/*
		 * Built once per column per render, not once per cell: asking per cell
		 * would scan the whole source table for every row of this one.
		 */
		const titleFieldId = field.backTitleFieldId ?? '';
		const key = `${field.backPath ?? ''}\u0000${field.backFieldId ?? ''}\u0000${titleFieldId}`;
		let index = this.backIndexes.get(key);
		if (index === undefined) {
			index = relationBackIndex(
				source,
				field.backFieldId ?? '',
				titleFieldId,
			);
			this.backIndexes.set(key, index);
		}
		if (index === null) {
			return { text: '', broken: 1 };
		}
		const texts = index.get(recordId) ?? [];
		return {
			text: texts.join(', '),
			broken: 0,
			chips: texts,
		};
	}

	/**
	 * The table a reverse relation reads: the one whose rows point back here.
	 *
	 * Resolved the same way a forward link is, including the filename fallback,
	 * and repaired the same way when it turns out to have moved.
	 */
	private sourceDoc(field: Field): LayerDoc | null {
		const path = field.backPath;
		if (!path) {
			return this.doc;
		}
		const resolved = this.plugin.tables.resolve(path);
		if (!resolved) {
			return null;
		}
		if (resolved !== path) {
			field.backPath = resolved;
			this.markDirty();
		}
		const source = this.plugin.tables.get(resolved);
		if (!source) {
			this.plugin.tables.ensure(resolved);
		}
		return source;
	}

	/**
	 * Applies an edit to the in-memory document and asks Obsidian to persist it.
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