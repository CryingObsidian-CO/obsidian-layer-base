import {
	Notice,
	TextFileView,
	type TFolder,
	type TFile,
	type WorkspaceLeaf,
} from 'obsidian';
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
import {
	copyTextFor,
	emptyValueFor,
	formatCell,
	relationIds,
	usesOptions,
} from '../model/fields';
import {computeFormula} from '../model/formula';
import {aggregateRollup} from '../model/rollup';
import {backfillNumbers, renumberAll} from '../model/records';
import {csvFileName, toCsv} from '../model/csv';
import {sortRecords} from '../model/sort';
import {filterRecords} from '../model/filter';
import {formulaErrorShort, formulaErrorMessage} from '../ui/formula-text';
import {
	relationBackIndex,
	relationBackRows,
	type BacklinkRow,
	relationCandidates as candidatesOf,
	relationText as textOf,
	repairRelationPaths,
	type RelationCandidate,
} from '../model/relation';
import {
	findGridView,
	setColumnWidth,
	setRowHeight,
} from '../model/layout';
import type {
	CellValue,
	Field,
	FormulaResultType,
	LayerDoc,
	LayerRecord,
	SelectOption,
	View,
} from '../types';
import {generateId} from '../utils/id';
import {ConfirmModal} from '../ui/confirm-modal';
import {ExportModal} from '../ui/export-modal';
import {SortPopover} from '../ui/sort-popover';
import {FilterPopover} from '../ui/filter-popover';
import {BoardFieldsPopover} from '../ui/board-fields-popover';
import type {Anchor} from '../ui/anchored-popover';
import {
	FieldEditorModal,
	type AutoNumberSettings,
	type BackSettings,
	type FieldEditorResult,
	type NumberSettings,
	type RelationSettings,
	type RollupSettings,
} from '../ui/field-editor-modal';
import type {GridSelection, RangeSize} from './grid/selection';
import {BoardShell, type ToolbarState} from './board-shell';
import {GridRenderer, type CellText} from './grid/grid-view';
import {KanbanRenderer} from './kanban/kanban-view';
import {valueForColumn, type KanbanColumn} from '../model/kanban';

export class LayerView extends TextFileView {
	private doc: LayerDoc | null = null;
	private pendingSelfWrite = false;
	private activeViewId: string | null = null;
	private selection: GridSelection | null = null;
	private rangeSize: RangeSize | null = null;
	private grid: GridRenderer | null = null;
	private kanban: KanbanRenderer | null = null;
	/** Reverse lookups for the current render pass, per source column. */
	private readonly backIndexes = new Map<
		string,
		Map<string, string[]> | null
	>();
	/** The pointing rows themselves, per source column, for the current render pass. */
	private readonly backRows = new Map<
		string,
		Map<string, BacklinkRow[]> | null
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

	/**
	 * Asks where the export goes, then writes it, and says where it landed.
	 *
	 * The text is built from the view rather than the stored document so it holds
	 * what is on screen: a computed column has no stored value to copy.
	 */
	private async handleExportCsv(): Promise<void> {
		const built = this.buildCsv();
		const file = this.file;
		if (!built || !file) {
			new Notice(t().noticeExportEmpty);
			return;
		}
		new ExportModal({
			app: this.app,
			boardFile: {
				path: file.path,
				basename: this.doc?.name ?? file.basename,
				parent: file.parent,
			},
			onSubmit: (result) => {
				void this.writeExport(result.folder, result.name, built.text);
			},
		}).open();
	}

	private async writeExport(
		folder: TFolder,
		name: string,
		text: string,
	): Promise<void> {
		try {
			const written = await this.plugin.store.writeExport(folder, name, text);
			new Notice(t().noticeExportDone(written.name));
		} catch (error) {
			new Notice(t().noticeExportFailed);
			console.error('[obsidian-layer-base] Failed to export CSV:', error);
		}
	}

	/**
	 * The current table as CSV text, or null when there is nothing open.
	 *
	 * Columns follow the grid rather than the file: a hidden column is not exported,
	 * because the reader hid it and an export is a copy of what they are looking at.
	 * Rows follow the rows on screen, so a hand-reordered table exports in that
	 * order.
	 */
	buildCsv(): { text: string; name: string } | null {
		const doc = this.doc;
		if (!doc) {
			return null;
		}
		const view = this.activeView();
		const hidden = new Set(view?.hiddenFieldIds ?? []);
		const fields = doc.fields.filter((field) => !hidden.has(field.id));
		const header = fields.map((field) => field.name);
		const rows = this.orderedRecords(doc, view).map((record) =>
			fields.map((field) => this.displayText(field, record)),
		);
		return {
			text: toCsv(header, rows),
			/*
			 * The base name only: the dialog shows it as a name and the writer adds
			 * `.csv`, so a reader never ends up with a file called `x.csv.csv`.
			 */
			name: csvFileName(doc.name).replace(/\.csv$/, ''),
		};
	}

	private render(): void {
		// The reverse lookups belong to the tree about to be thrown away.
		this.backIndexes.clear();
		this.backRows.clear();
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
			onExportCsv: () => {
				void this.handleExportCsv();
			},
			onOpenSort: (anchor) => {
				this.openSortPanel(anchor);
			},
			onOpenFilter: (anchor) => {
				this.openFilterPanel(anchor);
			},
		});
		// Top to bottom: actions on the data, then the projection of it, then a
		// read-only summary.
		shell.renderToolbar(this.toolbarState(view));
		shell.renderTabs({
			views: this.doc.views,
			activeViewId: view.id,
		});

		const mount = this.contentEl.createDiv({cls: 'layer-base-view'});
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
						? {kind: 'point', x: at.x, y: at.y}
						: el
							? {kind: 'element', el}
							: null;
					this.openFieldEditor(field, undefined, anchor);
				},
				onAddField: (after, anchor) => {
					this.openFieldEditor(null, after, anchor ? {
						kind: 'element',
						el: anchor
					} : null);
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
				rollupText: (field, recordId) => this.rollupText(field, recordId),
				formulaText: (field, recordId) =>
					this.formulaText(field, recordId),
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
			this.kanban = null;
			grid.render(this.doc, view, this.orderedRecords(this.doc, view));
		} else {
			this.grid = null;
			const kanban = new KanbanRenderer(mount, {
				onSetGroupField: (fieldId) => {
					this.handleGroupField(view, fieldId);
				},
				onMove: ({ recordId, column }) => {
					this.handleBoardMove(view, recordId, column);
				},
				onOpenRecord: (recordId) => {
					this.revealRecord(recordId);
				},
				onSetColumnLimit: (limit) => {
					this.handleColumnLimit(view, limit);
				},
				onSetShowEmpty: (show) => {
					this.handleShowEmptyColumns(view, show);
				},
				onOpenBoardFields: (anchor) => {
					this.openBoardFields(view, anchor);
				},
				displayText: (field, record) => this.displayText(field, record),
			});
			this.kanban = kanban;
			kanban.render(this.doc, view);
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

		/*
		 * A filtered table reports both numbers. Showing only the visible count would
		 * look like rows had been lost, and showing only the total would hide that a
		 * filter is on.
		 */
		const total = doc.records.length;
		const visible = this.orderedRecords(doc, view).length;
		this.statusEl = shell.renderStatusBar({
			recordCount: visible,
			totalRecordCount: total,
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

		const {anchor, focus} = selection;
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
			this.applyAutoNumberSettings(created, result.autoNumber);
			this.applyRollupSettings(created, result.rollup);
			this.applyFormulaSettings(created, result.formula, result.formulaType);
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
			this.applyAutoNumberSettings(field, result.autoNumber);
			this.applyRollupSettings(field, result.rollup);
			this.applyFormulaSettings(field, result.formula, result.formulaType);
			this.applyBackSettings(field, result.back);
		}

		this.markDirty();
		this.render();
	}

	/** Writes an auto number's padding and grouping, numbering existing rows. */
	private applyAutoNumberSettings(field: Field, settings: AutoNumberSettings): void {
		if (field.type !== 'autoNumber') {
			delete field.numberLength;
			delete field.numberGroupFieldId;
			return;
		}
		const groupingChanged =
			(field.numberGroupFieldId ?? '') !== settings.groupFieldId;
		field.numberLength = Math.max(1, Math.min(Math.floor(settings.length), 12));
		if (settings.groupFieldId === '') {
			delete field.numberGroupFieldId;
		} else {
			field.numberGroupFieldId = settings.groupFieldId;
		}
		const doc = this.doc;
		if (doc) {
			if (settings.renumber) {
				/*
				 * Asked for explicitly, so it runs in the order the reader is looking at
				 * rather than the stored order: after sorting a table, "renumber" means
				 * number what is on screen.
				 */
				renumberAll(doc, field, this.orderedRecords(doc, this.activeView()));
			} else if (groupingChanged) {
				renumberAll(doc, field);
			} else {
				backfillNumbers(doc, field);
			}
		}
		// Derived from the rows it numbers, so it is never required.
		delete field.required;
	}

	/**
	 * Writes a rollup's three settings. It stores no values, so there is nothing to
	 * clear: every cell is gathered again from the other table on each render.
	 */
	private applyRollupSettings(field: Field, settings: RollupSettings): void {
		if (field.type !== 'rollup') {
			delete field.rollupSourceFieldId;
			delete field.rollupFieldId;
			delete field.rollupAggregate;
			return;
		}
		if (settings.sourceFieldId === '') {
			delete field.rollupSourceFieldId;
		} else {
			field.rollupSourceFieldId = settings.sourceFieldId;
		}
		if (settings.fieldId === '') {
			delete field.rollupFieldId;
		} else {
			field.rollupFieldId = settings.fieldId;
		}
		field.rollupAggregate = settings.aggregate;
		// Derived, so it holds nothing and cannot be required.
		delete field.required;
	}

	/**
	 * Writes a formula's expression and how its result is presented. It stores no
	 * values, so there are no cells to clear when either changes — every cell is
	 * recomputed, and only its dressing follows the declared kind.
	 */
	private applyFormulaSettings(
		field: Field,
		formula: string,
		formulaType: FormulaResultType | null,
	): void {
		if (field.type !== 'formula') {
			delete field.formula;
			delete field.formulaType;
			return;
		}
		if (formula === '') {
			delete field.formula;
		} else {
			field.formula = formula;
		}
		// Absent means "follow the result", which is not worth writing down.
		if (formulaType === null) {
			delete field.formulaType;
		} else {
			field.formulaType = formulaType;
		}
		// Derived, so it holds nothing and cannot be required.
		delete field.required;
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
	 *
	 * The text comes from `displayText`, not from the stored cell, because a derived
	 * column stores nothing: copying the stored value gave an empty string where the
	 * screen showed a total. The stored value still travels alongside it, so pasting
	 * back into the same table keeps what the cells actually hold.
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
					fields.map((field) =>
						copyTextFor(
							field,
							record?.cells[field.id] ?? '',
							record ? this.displayText(field, record) : undefined,
						),
					),
				),
			),
			rows: records.map((record) =>
				fields.map((field) => {
					const value = record?.cells[field.id] ?? '';
					return {
						type: field.type,
						value,
						text: copyTextFor(
							field,
							value,
							record ? this.displayText(field, record) : undefined,
						),
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
		return this.grid?.renderedOrder() ?? {recordIds: [], fields: []};
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
		return {recordIds: grownRows, fields: grownFields};
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


	/**
	 * What the toolbar should say about the current order.
	 *
	 * Read from the view rather than remembered here, so it cannot drift from what
	 * the rows are actually doing.
	 */
	private toolbarState(view: View): ToolbarState {
		const columns: string[] = [];
		let descending = false;
		view.sorts.forEach((sort, index) => {
			const field = this.doc?.fields.find(
				(candidate) => candidate.id === sort.fieldId,
			);
			// A rule naming a column that is gone has nothing to show.
			if (!field) {
				return;
			}
			columns.push(field.name);
			if (index === 0) {
				descending = sort.order === 'desc';
			}
		});
		return {
			sort: { columns, descending },
			filterCount: view.filter.conditions.length,
		};
	}

	/**
	 * Opens the filter rules beside the button that asked for them.
	 *
	 * Every change is reported as it is made, so the rows follow the rules while
	 * they are still being written.
	 */
	private openFilterPanel(anchor: HTMLElement): void {
		const view = this.activeView();
		if (!view) {
			return;
		}
		new FilterPopover({
			app: this.app,
			anchor: { kind: 'element', el: anchor },
			fields: this.doc?.fields ?? [],
			filter: view.filter,
			onChange: (filter) => {
				const current = this.activeView();
				if (!current) {
					return;
				}
				current.filter = filter;
				this.markDirty();
				this.render();
			},
		}).open();
	}

	/**
	 * Opens the sort rules beside the button that asked for them.
	 *
	 * The panel reports every change, so the table follows it as the rules are
	 * edited rather than waiting for the panel to be dismissed.
	 */
	private openSortPanel(anchor: HTMLElement): void {
		const view = this.activeView();
		if (!view) {
			return;
		}
		new SortPopover({
			app: this.app,
			anchor: { kind: 'element', el: anchor },
			fields: this.doc?.fields ?? [],
			sorts: view.sorts,
			onChange: (sorts) => {
				const current = this.activeView();
				if (!current) {
					return;
				}
				current.sorts = sorts;
				this.markDirty();
				this.render();
			},
		}).open();
	}

	/**
	 * The rows in the order this view asks for.
	 *
	 * One place answers this so the grid and the export cannot disagree: a table
	 * sorted one way on screen and written out another would be worse than no sort.
	 * The document itself is left alone, so the stored order survives.
	 */
	/**
	 * The row names a relation cell points at, for filtering to compare against.
	 *
	 * Reuses the same resolution the cell itself is drawn with, so what is filtered
	 * on cannot differ from what is on screen. An unreadable table answers with no
	 * names, which is honest: there is nothing to compare yet.
	 */
	private relationNames(field: Field, value: CellValue): readonly string[] {
		return this.relationText(field, value).chips ?? [];
	}

	private orderedRecords(doc: LayerDoc, view: View | null): readonly LayerRecord[] {
		// Filtering first, then ordering: sorting rows that are about to be hidden is
		// work nobody sees, and it keeps "the visible rows" as one idea.
		const visible = filterRecords(doc.records, doc.fields, view?.filter, (field, value) =>
			this.relationNames(field, value),
		);
		return sortRecords(visible, doc.fields, view?.sorts ?? []);
	}

	/**
	 * What one cell reads as, whoever is asking.
	 *
	 * The grid and the CSV export both come through here, so what is written to a
	 * file cannot disagree with what the screen showed: a derived column contributes
	 * its computed value, a relation its names, and everything else its own text.
	 */
	private displayText(field: Field, record: LayerRecord): string {
		const value = record.cells[field.id] ?? emptyValueFor(field);
		if (field.type === 'relation') {
			return this.relationText(field, value).text;
		}
		if (field.type === 'relationBack') {
			return this.backText(field, record.id).text;
		}
		if (field.type === 'rollup') {
			return this.rollupText(field, record.id).text;
		}
		if (field.type === 'formula') {
			return this.formulaText(field, record.id).text;
		}
		return formatCell(field, value);
	}

	/**
	 * What a formula row computes to.
	 *
	 * The columns are re-read from the open document rather than trusted from the
	 * cell that asked: the grid was built from an earlier render, and a formula
	 * must read the values as they are now.
	 */
	private formulaText(field: Field, recordId: string): CellText {
		const doc = this.doc;
		if (!doc) {
			return {text: '', broken: 0};
		}
		const record = findRecord(doc, recordId);
		const target = doc.fields.find((candidate) => candidate.id === field.id);
		if (!record || !target) {
			return {text: '', broken: 0};
		}
		/*
		 * A column with no expression yet is not an error, it is a column waiting to
		 * be set up, so it reads as empty rather than reporting a failure in every
		 * row of a field that was just created.
		 */
		if ((target.formula ?? '').trim() === '') {
			return {text: '', broken: 0};
		}
		const result = computeFormula(doc, record, target);
		if (result.ok) {
			/*
			 * The text is always what was computed; only the dressing follows the
			 * column's declared kind. Coercing here would quietly change a result
			 * the reader can see, which is worse than presenting it plainly.
			 */
			return {
				text: result.text,
				broken: 0,
				kind: target.formulaType ?? result.kind,
				ticked: result.truthy,
			};
		}
		/*
		 * A broken formula says so in the cell, and is marked so it reads as a
		 * problem rather than as a value that happens to start with `#`.
		 *
		 * The cell names the KIND of mistake — a raw code like `trailing-text` tells
		 * a reader nothing — and the sentence explaining it travels as the hover and
		 * the accessible name.
		 */
		return {
			text: formulaErrorShort(result.error),
			broken: 1,
			hint: formulaErrorMessage(result.error),
		};
	}

	/** What a rollup gathered from the rows this row is linked to. */
	private rollupText(field: Field, recordId: string): CellText {
		const doc = this.doc;
		if (!doc) {
			return {text: '', broken: 0};
		}
		const record = findRecord(doc, recordId);
		const target = doc.fields.find((candidate) => candidate.id === field.id);
		if (!record || !target) {
			return {text: '', broken: 0};
		}
		const sourceField = doc.fields.find(
			(candidate) => candidate.id === target.rollupSourceFieldId,
		);
		// Not configured yet, or pointing at a column that is gone: a column waiting
		// to be set up reads as empty, not as a failure in every row.
		if (!sourceField || !target.rollupFieldId) {
			return {text: '', broken: 0};
		}

		const gathered = this.gatheredValues(sourceField, target, record, recordId);
		if (gathered === null) {
			return {text: '', broken: 0};
		}
		const answer = aggregateRollup(gathered, target.rollupAggregate ?? 'sum');
		if (answer === null) {
			return {text: '', broken: 0};
		}
		return {text: answer.text, broken: 0, kind: answer.kind};
	}

	/**
	 * The values a rollup reduces, or null when the other table cannot be read.
	 *
	 * Null is not the same as an empty list: an empty list means the other table was
	 * read and had nothing to contribute, which a count answers as zero.
	 */
	private gatheredValues(
		sourceField: Field,
		rollup: Field,
		record: LayerRecord,
		recordId: string,
	): readonly CellValue[] | null {
		const columnId = rollup.rollupFieldId ?? '';

		if (sourceField.type === 'relation') {
			const other = this.targetDoc(sourceField);
			if (!other) {
				return null;
			}
			return relationIds(record.cells[sourceField.id] ?? '').map(
				(id) => findRecord(other, id)?.cells[columnId] ?? '',
			);
		}

		if (sourceField.type === 'relationBack') {
			const other = this.sourceDoc(sourceField);
			if (!other) {
				return null;
			}
			const key = `${sourceField.id}\u0000${sourceField.backFieldId ?? ''}`;
			let rows = this.backRows.get(key);
			if (rows === undefined) {
				rows = relationBackRows(other, sourceField.backFieldId ?? '');
				this.backRows.set(key, rows);
			}
			if (rows === null) {
				return null;
			}
			return (rows.get(recordId) ?? []).map(
				(row) => row.record.cells[columnId] ?? '',
			);
		}

		// A source column that is neither kind is a configuration this column cannot
		// answer, so it reads as empty rather than guessing at a direction.
		return null;
	}

	private relationCandidates(field: Field): readonly RelationCandidate[] {
		const target = this.targetDoc(field);
		return target ? candidatesOf(target, field.linkFieldId ?? '') : [];
	}

	private relationText(field: Field, value: CellValue): CellText {
		const target = this.targetDoc(field);
		if (!target) {
			return {text: '', broken: relationIds(value).length};
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
			return {text: '', broken: 1};
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
			return {text: '', broken: 1};
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
	 * Moves a card to another column, by writing the value that column stands for.
	 *
	 * The write goes through the same `setCellValue` an edit does, so a value the
	 * column refuses is refused here too — which is what keeps a card from landing
	 * in a column it cannot actually belong to.
	 */
	private handleBoardMove(
		view: View,
		recordId: string,
		column: KanbanColumn,
	): void {
		const doc = this.doc;
		if (!doc || view.type !== 'kanban') {
			return;
		}
		const field = doc.fields.find(
			(candidate) => candidate.id === view.groupByFieldId,
		);
		/*
		 * The ungrouped column has no value, and that is what it writes: a drop there
		 * clears the cell. It is not refused for lacking a value, since lacking one
		 * is the whole point of it.
		 */
		if (!field || !column.droppable) {
			return;
		}
		const value = valueForColumn(field, column);
		if (!setCellValue(doc, recordId, field, value)) {
			return;
		}
		this.markDirty();
		this.render();
	}

	/**
	 * Opens the panel that chooses this board's columns.
	 *
	 * Reported on save rather than on every keystroke: the choice changes the whole
	 * board, and applying it as each box is ticked would redraw under the reader's
	 * cursor.
	 */
	private openBoardFields(view: View, anchor: HTMLElement): void {
		const doc = this.doc;
		if (!doc || view.type !== 'kanban') {
			return;
		}
		new BoardFieldsPopover({
			app: this.app,
			anchor: { kind: 'element', el: anchor },
			view,
			fields: doc.fields,
			primaryFieldId: doc.fields.find((field) => field.primary)?.id ?? '',
			onSubmit: (result) => {
				view.groupByFieldId = result.groupByFieldId;
				if (result.titleFieldId === '') {
					delete view.titleFieldId;
				} else {
					view.titleFieldId = result.titleFieldId;
				}
				view.cardFieldIds = result.cardFieldIds;
				this.markDirty();
				this.render();
			},
		}).open();
	}

	/** Switches which column this board groups by. */
	private handleGroupField(view: View, fieldId: string): void {
		if (view.type !== 'kanban') {
			return;
		}
		view.groupByFieldId = fieldId;
		this.markDirty();
		this.render();
	}

	/** Stores whether this board draws columns no row uses yet. */
	private handleShowEmptyColumns(view: View, show: boolean): void {
		if (view.type !== 'kanban') {
			return;
		}
		// Removed rather than set to false, so a board that was never changed keeps
		// no key in the file.
		if (show) {
			view.showEmptyColumns = true;
		} else {
			delete view.showEmptyColumns;
		}
		this.markDirty();
		this.render();
	}

	/** Stores a column limit on this board, which is a property of the board. */
	private handleColumnLimit(view: View, limit: number): void {
		if (view.type !== 'kanban') {
			return;
		}
		view.columnLimit = limit;
		this.markDirty();
		this.render();
	}

	/**
	 * Brings a row into view.
	 *
	 * A card carries a title and nothing else, so editing belongs in the table. The
	 * board switches to it rather than opening an editor over the cards: the row has
	 * many columns, and only the table has room for them.
	 */
	private revealRecord(recordId: string): void {
		const doc = this.doc;
		if (!doc) {
			return;
		}
		const grid = doc.views.find((view) => view.type === 'grid');
		if (!grid) {
			return;
		}
		this.activeViewId = grid.id;
		this.render();
		// Selecting it after the redraw, so the row exists to be selected.
		window.setTimeout(() => {
			this.grid?.revealRecord(recordId);
		}, 0);
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
		/*
		 * A value that is part of the order has to be allowed to move its row. The
		 * grid repaints the one cell it changed, which is right for every other
		 * column — redrawing the table on each keystroke would fight the editor —
		 * but a sorted column has to be rendered again for its row to move.
		 */
		if (this.changesTheOrder(field)) {
			this.render();
		}
	}

	/**
	 * Whether writing this column can change where rows belong.
	 *
	 * Only the columns the view sorts by matter: no other value takes part in the
	 * comparison, so no other value can move a row.
	 */
	private changesTheOrder(field: Field): boolean {
		const view = this.activeView();
		if (!view) {
			return false;
		}
		return view.sorts.some((sort) => sort.fieldId === field.id);
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
		const box = this.contentEl.createDiv({cls: 'layer-base-message'});
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
