import {
	FileView,
	Notice,
	Scope,
	TFile,
	TextFileView,
	type TFolder,
	type WorkspaceLeaf,
} from 'obsidian';
import {LAYER_EXTENSION, VIEW_TYPE_LAYER} from '../constants';
import {t} from '../i18n';
import {parseLayerDoc, serializeLayerDoc} from '../io/schema';
import {sameDocument} from '../io/same-document';
import {FutureVersionError} from '../io/migrate';
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
	canBeRequired,
	copyTextFor,
	emptyValueFor,
	formatCell,
	relationIds,
	usesOptions,
} from '../model/fields';
import {noteLabel} from '../model/note-path';
import {csvFileName, toCsv} from '../model/csv';
import {sortRecords} from '../model/sort';
import {filterRecords} from '../model/filter';
import {formulaErrorShort, formulaErrorMessage} from '../ui/formula-text';
import { CellReader as CellTableReader } from '../model/cell-reader';
import {
	relationCandidates as candidatesOf,
	repairRelationPaths,
	type RelationCandidate,
	type CellReader,
} from '../model/relation';
import {
	findGridView,
	setColumnWidth,
	setRowHeight,
	setRowHeightPreset,
	setWrap,
	type RowHeightPreset,
} from '../model/layout';
import {colorRulesOf, rowColorOf, rowTint, setColorRules} from '../model/colors';
import {affectedByEdit} from '../model/dependencies';
import {
	LAYER_FORMAT_VERSION,
	type CellValue,
	type ColorRule,
	type Field,
	type FormulaResultType,
	type GridView,
	type LayerDoc,
	type LayerRecord,
	type SelectOption,
	type View,
} from '../types';
import {generateId} from '../utils/id';
import {ConfirmModal} from '../ui/confirm-modal';
import {ExportModal} from '../ui/export-modal';
import {SortPopover} from '../ui/sort-popover';
import {FilterPopover} from '../ui/filter-popover';
import {BoardFieldsPopover} from '../ui/board-fields-popover';
import {
	addBoardView,
	canRemoveView,
	removeView,
	renameView,
} from '../model/views';
import type {Anchor} from '../ui/anchored-popover';
import {
	FieldEditorModal,
	type AutoNumberSettings,
	type BackSettings,
	type FieldEditorResult,
	type NumberSettings,
	type RelationSettings,
	type RollupSettings,
	type LookupSettings,
} from '../ui/field-editor-modal';
import type {GridSelection, RangeSize} from './grid/selection';
import {BoardShell, type ToolbarState} from './board-shell';
import {GridRenderer, type CellText} from './grid/grid-view';
import {KanbanRenderer} from './kanban/kanban-view';
import {valueForColumn, type KanbanColumn} from '../model/kanban';
import type {SummaryKind} from '../model/summary';
import {History, type Snapshot} from '../model/history';
import {setHidden} from '../model/visibility';
import {ColumnVisibilityPopover} from '../ui/column-visibility-popover';
import {RowHeightPopover} from '../ui/row-height-popover';
import {ColorRulesPopover} from '../ui/color-rules-popover';
import {redrawOnce} from './redraw-guard';
import {scopeLedger} from './scope-ledger';

/** How long a failed conflict copy waits before its one automatic retry. */
const CONFLICT_RETRY_DELAY_MS = 30_000;

export class LayerView extends TextFileView {
	private doc: LayerDoc | null = null;
	/** The format version of a file this build refuses to read. */
	private unsupported: number | null = null;
	/** That file's text, so a save writes back exactly what was read. */
	private unsupportedText = '';
	/** The text handed to the file on the last save, to recognise its echo. */
	private lastSaved = '';
	/** The text this view believes the file on disk holds. */
	private lastDisk = '';
	private unsaved = false;
	private pendingExternal: string | null = null;
	private conflictRetryTimer: number | null = null;
	private conflictRetries = 0;
	/** Reads cannot be cancelled, so a stale answer carries its number and is dropped. */
	private loadSeq = 0;
	private activeViewId: string | null = null;
	private selection: GridSelection | null = null;
	private rangeSize: RangeSize | null = null;
	private readonly history = new History();
	private readonly reader: CellTableReader;
	private pendingEdit: { label: string; before: Snapshot } | null = null;
	private grid: GridRenderer | null = null;
	private kanban: KanbanRenderer | null = null;
	private repaintQueued = false;
	/** Guards a redraw so a commit that triggers one cannot re-enter it. */
	private readonly redraw = {busy: false};
	private statusEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, private readonly plugin: LayerBasePlugin) {
		super(leaf);
		this.reader = new CellTableReader({
			table: (field, from, direction) =>
				direction === 'back'
					? this.sourceDoc(field, from)
					: this.targetDoc(field, from),
			noteProperty: (path, key) => this.notePropertyValue(path, key),
			notePropertyHint: () => t().notePropUnreadable,
			formulaError: (error) => ({
				text: formulaErrorShort(error),
				hint: formulaErrorMessage(error),
			}),
		});
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
		this.loadSeq++;
		this.cancelConflictRetry();
		this.conflictRetries = 0;
		this.lastSaved = '';
		this.lastDisk = '';
		this.unsaved = false;
		this.pendingExternal = null;
		// Another file is another document; steps from the old one must not replay here.
		this.history.clear();
		await super.onLoadFile(file);
	}

	onload(): void {
		super.onload();
		/*
		 * A hotkey set on a command is global, and Obsidian takes the key before deciding
		 * whether the command applies, so this view gets a scope of its own instead.
		 */
		this.registerUndoScope();

		/*
		 * Saves are debounced by two seconds, so the last edit is still pending at quit;
		 * the quit event's task list is the only place it can be finished.
		 */
		this.registerEvent(
			this.app.workspace.on('quit', (tasks) => {
				tasks.add(async () => {
					this.commitOpenEdit();
					// Never saved with no document: `getViewData` answers '', which would empty the file.
					if (this.doc) {
						await this.save();
					}
				});
			}),
		);
		/* Another process (MCP server, sync client) can write this file while it is open;
		 * setViewData decides whether it can replace the document. */
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile && file.path === this.file?.path) {
					void this.reloadFromDisk();
				}
			}),
		);
		this.register(this.plugin.tables.onChange(() => this.onTargetLoaded()));
		// A rename carries the old and new path, the only way to follow a redirected table.
		this.register(
			this.plugin.tables.onRename((oldPath, newPath) =>
				this.repairLinks(oldPath, newPath),
			),
		);
	}

	private repairLinks(oldPath: string, newPath: string): void {
		if (!this.doc) {
			return;
		}
		if (repairRelationPaths(this.doc, oldPath, newPath) > 0) {
			this.markDirty();
		}
	}

	/** An open editor's text is still in the DOM, so a teardown commits it first. */
	private commitOpenEdit(): void {
		this.grid?.commitOpenEdit();
	}

	/** The base class flushes a pending save; the open editor has to be committed into it first. */
	async onUnloadFile(file: TFile): Promise<void> {
		this.commitOpenEdit();
		this.cancelConflictRetry();
		await super.onUnloadFile(file);
	}

	getViewData(): string {
		if (this.unsupported !== null) {
			/* Hand back the exact text: anything else would lose what a newer build wrote. */
			return this.unsupportedText;
		}
		if (!this.doc) {
			return '';
		}
		const text = serializeLayerDoc(this.doc);
		// Remembered to recognise this save echoing back: reading normalises a file
		// (a primary flag added, a created stamp filled in), so a re-read differs.
		this.lastSaved = text;
		return text;
	}

	/** An outside writer touched the file; `setViewData` sorts out whether the local edit wins. */
	private async reloadFromDisk(): Promise<void> {
		const file = this.file;
		if (file === null) {
			return;
		}
		const seq = ++this.loadSeq;
		let text: string;
		try {
			text = await this.app.vault.read(file);
		} catch {
			return;
		}
		/* The read may have outlived the file: another one opened, or a later read landed first. */
		if (this.file !== file || seq !== this.loadSeq || text === this.lastDisk) {
			return;
		}
		this.setViewData(text, false);
	}

	/** TextFileView debounces saves, so an outside write can land after the edit; keep the
	 * local copy as a conflict file. */
	async save(clear = false): Promise<void> {
		const file = this.file;
		const entryText = this.localText();
		if (file !== null && entryText !== '' && this.lastDisk !== '') {
			let disk: string | null;
			try {
				disk = await this.app.vault.read(file);
			} catch {
				// A file that cannot be read is left to the base class, which reports the failure.
				disk = null;
			}
			// A cell edit can commit while the file is read, so compare against what is held now.
			const current = this.localText();
			if (disk !== null && disk !== this.lastDisk && disk !== current) {
				this.pendingExternal = disk;
				this.unsaved = true;
			}
		}

		const incoming = this.pendingExternal;
		if (incoming !== null) {
			// An open editor holds text the document does not have yet; the copy has to include it.
			this.commitOpenEdit();
			const copyText = this.localText();
			if (copyText !== '' && file !== null) {
				try {
					const copy = await this.plugin.store.writeConflictCopy(file, copyText);
					new Notice(t().noticeConflictSaved(copy.path));
				} catch (error) {
					console.error('[layer-base] Could not save a conflict copy:', error);
					new Notice(t().noticeConflictFailed);
					this.scheduleConflictRetry();
					return;
				}
				if (this.localText() !== copyText) {
					// The document changed while the copy was written; adopting the outside
					// version now would drop that edit.
					this.requestSave();
					return;
				}
			}
			this.cancelConflictRetry();
			this.conflictRetries = 0;
			this.pendingExternal = null;
			this.unsaved = false;
			this.setViewData(incoming, false);
			return;
		}

		// Read right before the write: the document may change while the write is in flight.
		const written = this.localText();
		await super.save(clear);
		if (!clear) {
			this.lastDisk = written;
			// Only an unchanged document means the dirty flag describes what was saved.
			if (this.localText() === written) {
				this.unsaved = false;
			}
		}
	}

	private localText(): string {
		if (this.doc === null) {
			return this.unsupported !== null ? this.unsupportedText : '';
		}
		return serializeLayerDoc(this.doc);
	}

	/* A lock held for a moment (sync client, scanner) clears on its own, so one retry
	 * after a pause; a lasting failure stays with the reader. */
	private scheduleConflictRetry(): void {
		if (this.conflictRetryTimer !== null || this.conflictRetries > 0) {
			return;
		}
		this.conflictRetries = 1;
		this.conflictRetryTimer = window.setTimeout(() => {
			this.conflictRetryTimer = null;
			this.requestSave();
		}, CONFLICT_RETRY_DELAY_MS);
	}

	private cancelConflictRetry(): void {
		if (this.conflictRetryTimer !== null) {
			window.clearTimeout(this.conflictRetryTimer);
			this.conflictRetryTimer = null;
		}
	}

	setViewData(data: string, _clear: boolean): void {
		/*
		 * An echo of our own save: the same text, or the same content once reading has
		 * normalised it. Clearing history on a false positive is destructive and silent.
		 */
		if (this.lastSaved !== '' && data === this.lastSaved) {
			this.lastSaved = '';
			this.lastDisk = data;
			return;
		}

		// An open cell edit lives in the DOM; commit it before comparing with the outside text.
		this.commitOpenEdit();

		let parsed: ReturnType<typeof parseLayerDoc>;
		try {
			parsed = parseLayerDoc(data);
		} catch (error) {
			if (error instanceof FutureVersionError) {
				this.refuseVersion(error.version, data);
				return;
			}
			throw error;
		}

		if (data !== '' && this.doc && this.sameContent(parsed.doc)) {
			this.lastDisk = data;
			return;
		}

		/*
		 * An outside write while an unsaved edit is held: keep the local document and let
		 * save() copy it aside. A truncated file counts too, and `doc === null` is what
		 * tells a first load apart from an outside write.
		 */
		if (this.doc !== null && this.unsaved) {
			if (this.pendingExternal === null) {
				new Notice(t().noticeExternalChangePending);
				// A different outside change gets its own single retry.
				this.conflictRetries = 0;
			}
			this.pendingExternal = data;
			return;
		}

		const {doc, warnings, dropped} = parsed;
		this.doc = doc;
		this.unsupported = null;
		this.unsupportedText = '';
		this.lastSaved = '';
		this.lastDisk = data;
		/* Steps recorded against the previous contents no longer describe what just arrived. */
		this.history.clear();

		if (warnings.length > 0) {
			new Notice(t().noticeParseWarnings(warnings.length));
			console.warn(
				`[layer-base] Repaired ${warnings.length} issue(s) while reading "${this.file?.path ?? 'unknown'}":`,
				warnings,
			);
		}

		if (dropped.length > 0) {
			/* A value is gone, so the notice names the column and value; a loss stays up longer. */
			new Notice(t().noticeCellsCleared(dropped), 12000);
			console.warn(
				`[layer-base] Cleared ${dropped.length} cell(s) that held a value their column cannot take, in "${this.file?.path ?? 'unknown'}":`,
				dropped,
			);
		}

		this.render();
	}

	clear(): void {
		this.loadSeq++;
		this.cancelConflictRetry();
		this.conflictRetries = 0;
		this.doc = null;
		this.unsupported = null;
		this.unsupportedText = '';
		this.lastSaved = '';
		this.lastDisk = '';
		this.unsaved = false;
		this.pendingExternal = null;
		this.contentEl.empty();
	}
	/** Marks the document dirty and schedules a save; it records no undo step. */
	markDirty(): void {
		if (!this.doc) {
			return;
		}
		this.unsaved = true;
		this.requestSave();
	}

	/* Snapshot taken before the edit; nothing is recorded unless `commitEdit` follows,
	 * so an edit that changed nothing leaves no step. */
	private beginEdit(label: string): string {
		this.pendingEdit = this.doc
			? { label, before: this.history.snapshot(this.doc) }
			: null;
		return label;
	}

	private commitEdit(): void {
		const pending = this.pendingEdit;
		this.pendingEdit = null;
		if (!pending) {
			return;
		}
		this.history.push(pending.label, pending.before);
		this.markDirty();
	}

	runUndo(): void {
		this.handleUndo();
	}

	runRedo(): void {
		this.handleRedo();
	}

	/*
	 * `ItemView.scope` is null until something creates one, and a binding made against
	 * it never fires. Popped as well as pushed, or a leftover scope swallows the key.
	 */
	private registerUndoScope(): void {
		const scope = new Scope(this.app.scope);
		/* A text field keeps its own undo, so the key has to reach the browser there. */
		const undo = (event: KeyboardEvent): false | undefined => {
			if (isTextEntry(event.target)) {
				return undefined;
			}
			event.preventDefault();
			this.handleUndo();
			return false;
		};
		const redo = (event: KeyboardEvent): false | undefined => {
			if (isTextEntry(event.target)) {
				return undefined;
			}
			event.preventDefault();
			this.handleRedo();
			return false;
		};
		scope.register(['Mod'], 'z', undo);
		scope.register(['Mod', 'Shift'], 'z', redo);
		// Ctrl+Y redoes too, the habit on Windows.
		scope.register(['Mod'], 'y', redo);

		// The last-clicked view owns the key; one in a background tab owns nothing.
		const ledger = scopeLedger(
			scope,
			(inner) => this.app.keymap.pushScope(inner),
			(inner) => this.app.keymap.popScope(inner),
		);
		// A click fires `pointerdown` and the first also `focusin`; the ledger makes that one scope.
		this.registerDomEvent(this.contentEl, 'focusin', () => ledger.acquire());
		this.registerDomEvent(this.contentEl, 'pointerdown', () => ledger.acquire());
		this.registerDomEvent(this.contentEl, 'focusout', (event) => {
			// Only when focus leaves the view, not when it moves between two cells inside it.
			const next = event.relatedTarget as Node | null;
			if (next && this.contentEl.contains(next)) {
				return;
			}
			/* An editor that ends takes its input out of the page and focus lands nowhere;
			 * releasing there leaves the table looking active but deaf to the key. */
			if (!next) {
				return;
			}
			ledger.release();
		});
		/* Focus may have gone nowhere, so a press outside the view still has to release the scope. */
		this.registerDomEvent(
			document,
			'pointerdown',
			(event) => {
				const target = event.target as Node | null;
				if (!target || !this.contentEl.contains(target)) {
					ledger.release();
				}
			},
			true,
		);
		// A view closed while focused must not leave its scope on the stack.
		this.register(() => ledger.release());
	}

	private handleUndo(): void {
		const doc = this.doc;
		if (!doc) {
			return;
		}
		const restored = this.history.undo({ fields: doc.fields, records: doc.records });
		if (!restored) {
			return;
		}
		this.restoreData(restored);
	}

	private handleRedo(): void {
		const doc = this.doc;
		if (!doc) {
			return;
		}
		const restored = this.history.redo({ fields: doc.fields, records: doc.records });
		if (!restored) {
			return;
		}
		this.restoreData(restored);
	}

	/* Fields and records only: undoing a deleted row should not also put a column
	 * width or a filter back, and the restore takes no undo step of its own. */
	private restoreData(restored: { fields: Field[]; records: LayerRecord[] }): void {
		if (!this.doc) {
			return;
		}
		this.doc.fields = restored.fields;
		this.doc.records = restored.records;
		// Ids in the selection may belong to rows that no longer exist.
		this.selection = null;
		this.markDirty();
		this.render();
	}

	/* Compared as a whole document: a rename, a filter or a board setting is the reader's
	 * too, so an echo test that ignored one would write ours back over theirs. */
	private sameContent(incoming: LayerDoc): boolean {
		const doc = this.doc;
		return doc !== null && sameDocument(incoming, doc);
	}

	/* The document is dropped rather than replaced with an empty board, which would be
	 * an editable table writing over data this build does not understand. */
	private refuseVersion(version: number, text: string): void {
		this.doc = null;
		this.unsupported = version;
		this.unsupportedText = text;
		this.lastSaved = '';
		this.lastDisk = text;
		this.history.clear();
		this.selection = null;
		this.render();
	}

	/** A path in a cell says where a note belongs, so it is created when missing. */
	private openNotePath(path: string): void {
		const existing = this.resolveNote(path);
		if (existing) {
			this.showFile(existing);
			return;
		}
		const target = noteTarget(path);
		void this.createNote(target, path);
	}

	/** A new tab, never this one; an existing tab already showing it is revealed instead. */
	private showFile(file: TFile): void {
		const shown = this.app.workspace.getLeavesOfType('markdown').find((leaf) => {
			const view = leaf.view;
			return view instanceof FileView && view.file?.path === file.path;
		});
		if (shown) {
			void this.app.workspace.revealLeaf(shown);
			return;
		}
		void this.app.workspace.getLeaf(true).openFile(file);
	}

	private async createNoteFile(target: string, shown: string): Promise<TFile | null> {
		try {
			const slash = target.lastIndexOf('/');
			if (slash > 0) {
				await this.ensureFolder(target.slice(0, slash));
			}
			const file = await this.app.vault.create(target, '');
			new Notice(t().noticeNoteCreated(shown));
			return file;
		} catch {
			new Notice(t().noticeNoteCreateFailed(shown));
			return null;
		}
	}

	private async createNote(target: string, shown: string): Promise<void> {
		const file = await this.createNoteFile(target, shown);
		if (file) {
			this.showFile(file);
		}
	}

	private async ensureFolder(path: string): Promise<void> {
		let current = '';
		for (const part of path.split('/')) {
			current = current === '' ? part : `${current}/${part}`;
			if (!this.app.vault.getAbstractFileByPath(current)) {
				await this.app.vault.createFolder(current);
			}
		}
	}

	/** A path may be typed by hand, so both extension forms and a link resolution are tried. */
	private resolveNote(path: string): TFile | null {
		for (const candidate of [path, `${path}.md`]) {
			const file = this.app.vault.getAbstractFileByPath(candidate);
			if (file instanceof TFile) {
				return file;
			}
		}
		return this.app.metadataCache.getFirstLinkpathDest(path, '');
	}


	/** The text is built from the view, not the stored document: a computed column stores nothing. */
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
			new Notice(t().noticeExportDone(written.path));
		} catch (error) {
			new Notice(t().noticeExportFailed);
			console.error('[layer-base] Failed to export CSV:', error);
		}
	}

	/* What is on screen: hidden columns are left out and rows keep the view's order,
	 * since an export is a copy of what the reader is looking at. */
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
			text: toCsv(header, rows, {guardFormulas: true}),
			/* Base name only: the writer adds `.csv`, so this must not end up as `x.csv.csv`. */
			name: csvFileName(doc.name).replace(/\.csv$/, ''),
		};
	}

	private render(): void {
		/* A redraw replaces the tree an open editor lives in, so commit it first; a commit
		 * that asks for a redraw itself is folded into this one pass. */
		redrawOnce(
			this.redraw,
			() => this.commitOpenEdit(),
			() => this.draw(),
		);
	}

	/** Go through `render()`: it commits an open edit before the tree this rebuilds. */
	private draw(): void {
		/* Read before the tree goes: the renderer that knows the offset is the one being discarded. */
		const offset = this.grid?.offset() ?? { left: 0, top: 0 };

		// The reverse lookups belong to the tree about to be thrown away.
		this.reader.reset();
		this.contentEl.empty();
		this.contentEl.addClass('layer-base-container');

		if (this.unsupported !== null) {
			this.renderMessage(t().unsupportedVersion(this.unsupported, LAYER_FORMAT_VERSION));
			return;
		}

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
			onAddView: () => {
				this.handleAddBoardView();
			},
			onRenameView: (viewId, name) => {
				this.handleRenameView(viewId, name);
			},
			canDeleteView: (viewId) => {
				const view = this.doc?.views.find((candidate) => candidate.id === viewId);
				return view !== undefined && canRemoveView(view);
			},
			onDeleteView: (viewId) => {
				this.handleDeleteView(viewId);
			},
			onOpenViewFields: (anchor) => {
				this.openViewFields(anchor);
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
			onOpenRowHeight: (anchor) => {
				this.openRowHeightPanel(anchor);
			},
			onOpenColorRules: (anchor) => {
				this.openColorRulesPanel(anchor);
			},
			canUndo: () => this.history.canUndo,
			canRedo: () => this.history.canRedo,
			onUndo: () => this.handleUndo(),
			onRedo: () => this.handleRedo(),
			onOpenFilter: (anchor) => {
				this.openFilterPanel(anchor);
			},
		});
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
					// Keyboard activation gives no coordinates, so the column header stands in as anchor.
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
				onOpenNote: (path) => this.openNotePath(path),
				noteLabelStyle: () => this.plugin.settings.noteLabel,
				notePropText: (field, recordId) => this.notePropText(field, recordId),
				onCreateOption: (field, name) =>
					this.handleCreateOption(field, name),
				relationCandidates: (field) =>
					this.relationCandidates(field),
				relationText: (field, value) => this.relationText(field, value),
				backText: (field, recordId) => this.backText(field, recordId),
				rollupText: (field, recordId) => this.rollupText(field, recordId),
				lookupText: (field, recordId) => this.lookupText(field, recordId),
				autoNumberText: (field, recordId) =>
					this.autoNumberCellText(field, recordId),
				cellText: (field, record) => this.displayText(field, record),
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
				rowColor: (record) => this.rowTintOf(view, record),
				onSetSummary: (fieldId, kind) => {
					this.handleSetSummary(fieldId, kind);
				},
			});
			this.grid = grid;
			this.kanban = null;
			// Handed over before the first render, which is what applies it.
			grid.restoreTo(offset.left, offset.top);
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
				onOpenNote: (path) => this.openNotePath(path),
				noteLabelStyle: () => this.plugin.settings.noteLabel,
				cellText: (field, record) => this.cellTextOf(field, record),
				onSetColumnLimit: (limit) => {
					this.handleColumnLimit(view, limit);
				},
				onSetShowEmpty: (show) => {
					this.handleShowEmptyColumns(view, show);
				},
				displayText: (field, record) => this.displayText(field, record),
			});
			this.kanban = kanban;
			kanban.render(this.doc, view);
		}

		this.renderStatus(shell);
	}

	private renderStatus(shell: BoardShell): void {
		const doc = this.doc;
		const view = this.activeView();
		if (!doc || !view) {
			return;
		}
		const columns = view.type === 'grid' ? this.visibleColumnCount(view) : null;

		/* Both numbers: the visible count alone looks like rows were lost, the total alone
		 * hides that a filter is on. */
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

	private selectionLabel(): string {
		const selection = this.selection;
		const doc = this.doc;
		if (!selection || !doc) {
			return '';
		}

		if (selection.kind === 'row') {
			const index = this.displayRowIndexOf(selection.recordId);
			return index === -1 ? '' : t().selectionRow(index + 1);
		}

		if (selection.kind === 'column') {
			const field = doc.fields.find((f) => f.id === selection.fieldId);
			return field ? t().selectionColumn(field.name) : '';
		}

		const {anchor, focus} = selection;
		if (anchor.recordId === focus.recordId && anchor.fieldId === focus.fieldId) {
			const index = this.displayRowIndexOf(anchor.recordId);
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

	/* The numbers beside the table count what is on screen: once sorted or filtered,
	 * the file's own order points at a row the reader cannot see. */
	private displayRowIndexOf(recordId: string): number {
		const doc = this.doc;
		if (!doc) {
			return -1;
		}
		return this.orderedRecords(doc, this.activeView()).findIndex(
			(record) => record.id === recordId,
		);
	}

	private visibleColumnCount(view: View): number {
		if (!this.doc) {
			return 0;
		}
		const hidden = new Set(view.hiddenFieldIds);
		return this.doc.fields.filter((f) => !hidden.has(f.id)).length;
	}

	private handleAddRecord(): void {
		if (!this.doc) {
			return;
		}
		this.beginEdit('add-record');
		addRecord(this.doc);
		this.commitEdit();
		this.render();
	}

	private handleAddRecordAtTop(): void {
		if (!this.doc) {
			return;
		}
		this.beginEdit('add-record');
		addRecordAtTop(this.doc);
		this.commitEdit();
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

		// Adding a column or changing a type clears it, so the whole application is one step.
		this.beginEdit(field === null ? 'add-field' : 'field-edit');

		let written: Field;
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
			this.applyLookupSettings(created, result.lookup);
			this.applyFormulaSettings(created, result.formula, result.formulaType);
			this.applyNotePropSettings(created, result.noteProp);
			this.applyBackSettings(created, result.back);
			if (after) {
				insertFieldAfter(doc, after.id, created);
			} else {
				addField(doc, created);
			}
			written = created;
		} else {
			field.name = result.name;
			if (usesOptions(result.type)) {
				field.options = result.options;
			}
			// Removed rather than set to false, so a cleared flag leaves no dead key in the file.
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
			// After the type change, which clears these when the field stops being a number.
			this.applyNumberSettings(field, result.number);
			this.applyRelationSettings(doc, field, result.relation);
			this.applyAutoNumberSettings(field, result.autoNumber);
			this.applyRollupSettings(field, result.rollup);
			this.applyLookupSettings(field, result.lookup);
			this.applyFormulaSettings(field, result.formula, result.formulaType);
			this.applyNotePropSettings(field, result.noteProp);
			this.applyBackSettings(field, result.back);
			written = field;
		}

		// A computed column is never offered the flag; this guard covers a stale panel.
		if (!canBeRequired(written.type)) {
			delete written.required;
		}

		this.commitEdit();
		this.render();
	}

	/* The number is counted from the row order at draw time, so no cell is written here. */
	private applyAutoNumberSettings(field: Field, settings: AutoNumberSettings): void {
		if (field.type !== 'autoNumber') {
			delete field.numberLength;
			delete field.numberGroupFieldId;
			return;
		}
		field.numberLength = Math.max(1, Math.min(Math.floor(settings.length), 12));
		if (settings.groupFieldId === '') {
			delete field.numberGroupFieldId;
		} else {
			field.numberGroupFieldId = settings.groupFieldId;
		}
	}

	/* Stores no values: every cell is gathered from the other table on each render. */
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
	}

	private applyLookupSettings(field: Field, settings: LookupSettings): void {
		if (field.type !== 'lookup') {
			delete field.lookupSourceFieldId;
			delete field.lookupFieldId;
			return;
		}
		if (settings.sourceFieldId === '') {
			delete field.lookupSourceFieldId;
		} else {
			field.lookupSourceFieldId = settings.sourceFieldId;
		}
		if (settings.fieldId === '') {
			delete field.lookupFieldId;
		} else {
			field.lookupFieldId = settings.fieldId;
		}
	}

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
	}

	/* Pointing at another table or column clears the cells: the stored row ids no
	 * longer mean what they did. Same rule as changing a field's type. */
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
			this.beginEdit('delete-records');
			if (removeRecords(doc, recordIds) === 0) {
				this.pendingEdit = null;
				return;
			}
			this.commitEdit();
			this.render();
			return;
		}

		new ConfirmModal(this.app, {
			title: t().menuDeleteRow,
			message: t().recordsDeleteConfirm(recordIds.length),
			confirmText: t().menuDeleteRow,
			onConfirm: () => {
				this.beginEdit('delete-records');
				if (removeRecords(doc, recordIds) === 0) {
					this.pendingEdit = null;
					return;
				}
				this.commitEdit();
				this.render();
			},
		}).open();
	}

	private handleInsertRecordsBelow(recordId: string, count: number): void {
		if (!this.doc || count < 1) {
			return;
		}
		this.beginEdit('insert-records');
		insertRecordsAfter(this.doc, recordId, count);
		this.commitEdit();
		this.render();
	}

	private handleDuplicateRecords(recordIds: string[]): void {
		if (!this.doc) {
			return;
		}
		this.beginEdit('duplicate-records');
		if (duplicateRecords(this.doc, recordIds) === 0) {
			this.pendingEdit = null;
			return;
		}
		this.commitEdit();
		this.render();
	}

	/** Stores what a column's footer reports, which belongs to the view. */
	private handleSetSummary(fieldId: string, kind: SummaryKind): void {
		const view = this.activeView();
		if (!view || view.type !== 'grid') {
			return;
		}
		const summaries = view.summaries ?? {};
		if (kind === 'none') {
			delete summaries[fieldId];
		} else {
			summaries[fieldId] = kind;
		}
		view.summaries = summaries;
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

	/** Only a table has rows to give a height to. */
	private openRowHeightPanel(anchor: HTMLElement): void {
		const doc = this.doc;
		const view = doc ? findGridView(doc, this.activeView()?.id ?? '') : null;
		if (!view) {
			return;
		}
		new RowHeightPopover({
			app: this.app,
			anchor: { kind: 'element', el: anchor },
			view,
			onChoose: (preset) => {
				this.handleRowHeightPreset(view, preset);
			},
			onToggleWrap: (wrap) => {
				this.handleRowWrap(view, wrap);
			},
		}).open();
	}

	/* This is also the undo for a dragged row: choosing a height speaks for the whole table. */
	private handleRowHeightPreset(view: GridView, preset: RowHeightPreset): void {
		setRowHeightPreset(view, preset);
		this.markDirty();
		this.render();
	}

	private handleRowWrap(view: GridView, wrap: boolean): void {
		setWrap(view, wrap);
		this.markDirty();
		this.render();
	}

	private openColorRulesPanel(anchor: HTMLElement): void {
		const doc = this.doc;
		const view = doc ? findGridView(doc, this.activeView()?.id ?? '') : null;
		if (!doc || !view) {
			return;
		}
		new ColorRulesPopover({
			app: this.app,
			anchor: { kind: 'element', el: anchor },
			view,
			fields: doc.fields,
			onChange: (rules) => {
				this.handleColorRules(view, rules);
			},
		}).open();
	}

	private handleColorRules(view: GridView, rules: readonly ColorRule[]): void {
		setColorRules(view, rules);
		this.markDirty();
		this.render();
	}

	/* Resolved the same way the filter resolves a row: a colour rule that disagreed
	 * would tint rows the filter had just hidden. */
	private rowTintOf(view: GridView, record: LayerRecord): string | null {
		const doc = this.doc;
		if (!doc) {
			return null;
		}
		const color = rowColorOf(
			view,
			record,
			doc.fields,
			(field, value) => this.relationNames(field, value),
			(field, row) => this.compareTextOf(field, row),
		);
		return color === null ? null : rowTint(color);
	}

	/* The text comes from `displayText`: a derived column stores nothing, so copying the
	 * stored value gives an empty string where the screen shows a total. */
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

	private renderedOrder(): { recordIds: string[]; fields: Field[] } {
		return this.grid?.renderedOrder() ?? {recordIds: [], fields: []};
	}

	/** Grows the target rectangle to the clipboard's shape, as a spreadsheet does. */
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
			this.beginEdit('paste');
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
		this.beginEdit('paste');
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
		this.commitEdit();
		this.render();
	}

	private handleClearCells(recordIds: string[], fields: Field[]): void {
		const doc = this.doc;
		if (!doc) {
			return;
		}
		this.beginEdit('clear-cells');
		if (clearCells(doc, recordIds, fields) === 0) {
			this.pendingEdit = null;
			return;
		}
		this.commitEdit();
		this.render();
	}

	private handleClearRecord(recordId: string): void {
		if (!this.doc) {
			return;
		}
		this.beginEdit('clear-record');
		if (clearRecord(this.doc, recordId)) {
			this.commitEdit();
			this.render();
		}
	}

	/** Copies a column's definition without its values. */
	private handleDuplicateField(field: Field): void {
		if (!this.doc) {
			return;
		}
		this.beginEdit('duplicate-field');
		if (duplicateField(this.doc, field.id)) {
			this.commitEdit();
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
				this.beginEdit('delete-field');
				if (removeField(doc, field.id)) {
					this.commitEdit();
					this.render();
				}
			},
		}).open();
	}

	/* The option has to exist before the value that names it: the cell editor commits
	 * the value afterwards, through `onCellCommit`. */
	private handleCreateOption(field: Field, name: string): SelectOption | null {
		const doc = this.doc;
		if (!doc) {
			return null;
		}
		// Re-resolved by id: the caller's field may be a stale copy from an earlier render.
		const target = doc.fields.find((candidate) => candidate.id === field.id);
		if (!target) {
			return null;
		}
		const option = appendOption(target, name);
		this.markDirty();
		return option;
	}

	/* A field with no path links to this table; anything else goes through the vault
	 * index. A miss is not an error: the read is started and a repaint fills the cell. */
	private targetDoc(field: Field, doc: LayerDoc | null): LayerDoc | null {
		const path = field.linkPath;
		if (!path) {
			return doc;
		}
		const resolved = this.plugin.tables.resolve(path);
		if (!resolved) {
			return null;
		}
		if (resolved !== path) {
			/* Renamed or moved and found again by filename: the correction stays on the field,
			 * so the next save of this document writes it down. The plugin never writes a file
			 * it was not asked to edit, which is the only road the repair has to the disk. */
			field.linkPath = resolved;
			this.markDirty();
		}
		const target = this.plugin.tables.get(resolved);
		if (!target) {
			this.plugin.tables.ensure(resolved);
		}
		return target;
	}

	/* Deferred and coalesced: several tables can land together, and a repaint while a
	 * cell is open would throw the editor away. */
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
			isGrid: view.type === 'grid',
		};
	}

	/** Every change is applied as it is made, so the rows follow while the rules are written. */
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

	/* The resolution the cell itself is drawn with, so filtering cannot disagree with
	 * what is on screen. An unreadable table answers with no names. */
	private relationNames(field: Field, value: CellValue): readonly string[] {
		const doc = this.doc;
		if (doc === null) {
			return [];
		}
		return this.relationTextIn(doc, field, value).chips ?? [];
	}

	private orderedRecords(doc: LayerDoc, view: View | null): readonly LayerRecord[] {
		// Filter first, then sort: no point ordering rows that are about to be hidden.
		const visible = filterRecords(
			doc.records,
			doc.fields,
			view?.filter,
			(field, value) => this.relationNames(field, value),
			(field, record) => this.compareTextOf(field, record),
		);
		return sortRecords(visible, doc.fields, view?.sorts ?? [], (field, record) =>
			this.compareTextOf(field, record),
		);
	}

	/* A note column compares by the text it shows (name or path, per the setting), so a
	 * sort agrees with the column. Copy and the CSV export still carry the path. */
	private compareTextOf(field: Field, record: LayerRecord): string | null {
		if (field.type === 'note') {
			const value = record.cells[field.id] ?? '';
			return typeof value === 'string'
				? noteLabel(value, this.plugin.settings.noteLabel)
				: '';
		}
		return this.cellTextOf(field, record);
	}

	/* Null leaves the type to the plain rules. `doc` is the table the cell belongs to,
	 * which is not always the open one: a lookup reads a column of another table. */
	private cellTextIn(
		doc: LayerDoc,
		field: Field,
		record: LayerRecord,
	): string | null {
		return this.reader.reading(doc, field, record)?.text ?? null;
	}

	private cellTextOf(field: Field, record: LayerRecord): string | null {
		const doc = this.doc;
		return doc === null ? null : this.cellTextIn(doc, field, record);
	}

	private readerIn(doc: LayerDoc): CellReader {
		return this.reader.readerIn(doc);
	}

	/* The grid and the CSV export both come through here, so a file cannot disagree with
	 * the screen. `cellTextOf` answers the types that need the view. */
	private displayText(field: Field, record: LayerRecord): string {
		const read = this.cellTextOf(field, record);
		if (read !== null) {
			return read;
		}
		return formatCell(field, record.cells[field.id] ?? emptyValueFor(field));
	}

	/* Both parts are dropped for any other type, so a column that stopped being a note
	 * property does not keep pointing into frontmatter. */
	private applyNotePropSettings(
		field: Field,
		settings: { sourceFieldId: string; key: string },
	): void {
		if (field.type !== 'noteProp') {
			delete field.noteFieldId;
			delete field.frontmatterKey;
			return;
		}
		if (settings.sourceFieldId === '') {
			delete field.noteFieldId;
		} else {
			field.noteFieldId = settings.sourceFieldId;
		}
		const key = settings.key.trim();
		if (key === '') {
			delete field.frontmatterKey;
		} else {
			field.frontmatterKey = key;
		}
	}

	private notePropValue(field: Field, recordId: string): string {
		const doc = this.doc;
		return doc === null ? '' : this.notePropValueIn(doc, field, recordId);
	}

	private notePropText(field: Field, recordId: string): CellText {
		return { text: this.notePropValue(field, recordId), broken: 0 };
	}

	/* Not in this document: it lives in the frontmatter of the note the row's note column
	 * names. */
	private notePropValueIn(
		doc: LayerDoc,
		field: Field,
		recordId: string,
	): string {
		return this.reader.notePropReading(doc, field, recordId).text;
	}

	private notePropertyValue(path: string, key: string): string | null {
		const file = this.resolveNote(path);
		if (!file) {
			return '';
		}
		return frontmatterText(this.app.metadataCache.getFileCache(file)?.frontmatter?.[key]);
	}

	/* Deliberately outside the undo steps: those hold a copy of this document, while the
	 * value being changed lives in another file. */
	private writeNoteProp(field: Field, recordId: string, value: CellValue): void {
		const doc = this.doc;
		const record = doc ? findRecord(doc, recordId) : undefined;
		if (!doc || !record) {
			return;
		}
		const source = doc.fields.find((candidate) => candidate.id === field.noteFieldId);
		if (!source || source.type !== 'note') {
			return;
		}
		const path = record.cells[source.id];
		if (typeof path !== 'string' || path === '') {
			return;
		}
		const text = typeof value === 'string' ? value : '';
		void this.applyNoteProp(path, field.frontmatterKey ?? field.name, text);
	}

	private async applyNoteProp(path: string, key: string, text: string): Promise<void> {
		const file =
			this.resolveNote(path) ?? (await this.createNoteFile(noteTarget(path), path));
		if (!file) {
			return;
		}
		try {
			await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
				if (text === '') {
					delete frontmatter[key];
				} else {
					frontmatter[key] = text;
				}
			});
		} catch {
			new Notice(t().noticeNoteCreateFailed(path));
		}
		this.render();
	}

	/* Re-read from the open document rather than trusted from the cell that asked: the
	 * grid was built from an earlier render. */
	private formulaTextIn(doc: LayerDoc, field: Field, recordId: string): CellText {
		return this.reader.formulaReading(doc, field, recordId);
	}

	private formulaText(field: Field, recordId: string): CellText {
		const doc = this.doc;
		return doc === null
			? {text: '', broken: 0}
			: this.formulaTextIn(doc, field, recordId);
	}

	private autoNumberTextIn(
		doc: LayerDoc,
		field: Field,
		recordId: string,
	): string {
		return this.reader.autoNumberReading(doc, field, recordId).text;
	}

	private autoNumberText(field: Field, recordId: string): string {
		const doc = this.doc;
		return doc === null ? '' : this.autoNumberTextIn(doc, field, recordId);
	}

	/** The same reading in the shape the grid asks for: a number, so it lines up. */
	private autoNumberCellText(field: Field, recordId: string): CellText {
		return {text: this.autoNumberText(field, recordId), broken: 0, kind: 'number'};
	}

	private rollupTextIn(doc: LayerDoc, field: Field, recordId: string): CellText {
		return this.reader.rollupReading(doc, field, recordId);
	}

	private rollupText(field: Field, recordId: string): CellText {
		const doc = this.doc;
		return doc === null
			? {text: '', broken: 0}
			: this.rollupTextIn(doc, field, recordId);
	}

	/* One chip per value; repeats stay repeated, since dropping one would forget a linked
	 * row. Nothing is stored, so it cannot go stale. */
	private lookupTextIn(doc: LayerDoc, field: Field, recordId: string): CellText {
		return this.reader.lookupReading(doc, field, recordId);
	}

	private lookupText(field: Field, recordId: string): CellText {
		const doc = this.doc;
		return doc === null
			? {text: '', broken: 0}
			: this.lookupTextIn(doc, field, recordId);
	}

	private relationCandidates(field: Field): readonly RelationCandidate[] {
		const doc = this.doc;
		const target = doc === null ? null : this.targetDoc(field, doc);
		if (!target) {
			return [];
		}
		return candidatesOf(target, field.linkFieldId ?? '', this.readerIn(target));
	}

	private relationTextIn(
		doc: LayerDoc,
		field: Field,
		value: CellValue,
	): CellText {
		return this.reader.relationReading(doc, field, value);
	}

	private relationText(field: Field, value: CellValue): CellText {
		const doc = this.doc;
		return doc === null
			? {text: '', broken: relationIds(value).length}
			: this.relationTextIn(doc, field, value);
	}

	private backTextIn(doc: LayerDoc, field: Field, recordId: string): CellText {
		return this.reader.backReading(doc, field, recordId);
	}

	private backText(field: Field, recordId: string): CellText {
		const doc = this.doc;
		return doc === null ? {text: '', broken: 1} : this.backTextIn(doc, field, recordId);
	}

	/* The table whose rows point back here. `doc` is used when the column names no table
	 * of its own; resolved and repaired the same way a forward link is. */
	private sourceDoc(field: Field, doc: LayerDoc | null): LayerDoc | null {
		const path = field.backPath;
		if (!path) {
			return doc;
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

	/* Through `setCellValue`, like any edit, so a value the column refuses keeps a card
	 * out of a column it cannot belong to. */
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
		if (!field || !column.droppable) {
			return;
		}
		/* The ungrouped column has no value and that is what it writes: a drop there clears
		 * the cell rather than being refused. */
		const value = valueForColumn(field, column);
		this.beginEdit('cell');
		if (!setCellValue(doc, recordId, field, value)) {
			this.pendingEdit = null;
			return;
		}
		this.commitEdit();
		this.render();
	}

	/* One button for both: a table hides and shows columns, a board chooses its grouping
	 * column, the card title and what a card carries. */
	private openViewFields(anchor: HTMLElement): void {
		const view = this.activeView();
		if (!view) {
			return;
		}
		if (view.type === 'kanban') {
			this.openBoardFields(view, anchor);
			return;
		}
		const doc = this.doc;
		if (!doc) {
			return;
		}
		new ColumnVisibilityPopover({
			app: this.app,
			anchor: { kind: 'element', el: anchor },
			view,
			fields: doc.fields,
			onToggle: (fieldId, hidden) => {
				this.handleToggleColumn(view, fieldId, hidden);
			},
		}).open();
	}

	/* `setHidden` owns the rule, so the panel and any other caller agree on what a table
	 * may hide. */
	private handleToggleColumn(
		view: View,
		fieldId: string,
		hidden: boolean,
	): void {
		const doc = this.doc;
		if (!doc) {
			return;
		}
		const field = doc.fields.find((candidate) => candidate.id === fieldId);
		if (!field) {
			return;
		}
		const outcome = setHidden(view, field, doc.fields, hidden);
		if (outcome !== 'changed') {
			// Only a refusal is worth a notice; a column already in that state changed nothing.
			if (outcome === 'refused') {
				new Notice(t().viewFieldsLastColumn);
			}
			return;
		}
		this.markDirty();
		this.render();
	}

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

	/* The table is left as it is: a board is another way of looking at the same rows. */
	private handleAddBoardView(): void {
		const doc = this.doc;
		if (!doc) {
			return;
		}
		const created = addBoardView(doc, t().boardViewName);
		if (!created) {
			new Notice(t().noticeNoGroupField);
			return;
		}
		this.activeViewId = created.id;
		this.markDirty();
		this.render();
	}

	private handleRenameView(viewId: string, name: string): void {
		const doc = this.doc;
		if (!doc) {
			return;
		}
		if (!renameView(doc, viewId, name)) {
			return;
		}
		this.markDirty();
		this.render();
	}

	/* A neighbour is picked before the redraw: the removed view may be the active one,
	 * and the fallback would lose the reader's place. */
	private handleDeleteView(viewId: string): void {
		const doc = this.doc;
		if (!doc) {
			return;
		}
		const index = doc.views.findIndex((view) => view.id === viewId);
		if (index === -1) {
			return;
		}
		const target = doc.views[index];
		// The menu greys the item out, but a keyboard or a stale menu can still reach this.
		if (target && !canRemoveView(target)) {
			new Notice(t().noticeTableViewKept);
			return;
		}
		if (!removeView(doc, viewId)) {
			return;
		}
		if (this.activeViewId === viewId) {
			const neighbour = doc.views[Math.max(0, index - 1)];
			this.activeViewId = neighbour?.id ?? null;
		}
		new Notice(t().noticeViewDeleted);
		this.markDirty();
		this.render();
	}

	private handleGroupField(view: View, fieldId: string): void {
		if (view.type !== 'kanban') {
			return;
		}
		view.groupByFieldId = fieldId;
		this.markDirty();
		this.render();
	}

	private handleShowEmptyColumns(view: View, show: boolean): void {
		if (view.type !== 'kanban') {
			return;
		}
		if (show) {
			view.showEmptyColumns = true;
		} else {
			delete view.showEmptyColumns;
		}
		this.markDirty();
		this.render();
	}

	private handleColumnLimit(view: View, limit: number): void {
		if (view.type !== 'kanban') {
			return;
		}
		view.columnLimit = limit;
		this.markDirty();
		this.render();
	}

	/* Editing belongs in the table: a card shows a title and the row has many columns,
	 * so the board switches to the grid rather than opening an editor over the cards. */
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

	private handleCellCommit(
		recordId: string,
		field: Field,
		value: CellValue,
	): void {
		if (!this.doc) {
			return;
		}
		/* A note property is answered by another file, so the edit belongs there; nothing here
		 * changes, so there is no undo step. */
		if (field.type === 'noteProp') {
			this.writeNoteProp(field, recordId, value);
			return;
		}
		this.beginEdit('cell');
		if (!setCellValue(this.doc, recordId, field, value)) {
			this.pendingEdit = null;
			console.warn(
				`[layer-base] Edit ignored for a record that no longer exists: ${recordId}`,
			);
			this.render();
			return;
		}
		this.commitEdit();
		this.refreshAfterEdit(recordId, field);
	}

	/*
	 * A grid repaints only the cell it edited, so anything that reads it keeps the old
	 * answer unless redrawn here. A value that takes part in the order or the filter can
	 * move its row, and only a whole render shows that.
	 */
	private refreshAfterEdit(recordId: string, field: Field): void {
		const doc = this.doc;
		const view = this.activeView();
		const record = doc ? findRecord(doc, recordId) : undefined;
		if (!doc || !view || !record) {
			this.render();
			return;
		}
		const stale = affectedByEdit(doc, field);
		const touched = new Set([field.id, ...stale.map((other) => other.id)]);
		const movesOrLeaves =
			view.sorts.some((sort) => touched.has(sort.fieldId)) ||
			view.filter.conditions.some((condition) =>
				touched.has(condition.fieldId),
			);
		/* A numbering column counted within the edited one changes for every row, so one
		 * row cannot be patched. */
		const renumbersOtherRows = stale.some(
			(other) =>
				other.type === 'autoNumber' && other.numberGroupFieldId === field.id,
		);
		const grid = this.grid;
		if (movesOrLeaves || renumbersOtherRows || !grid) {
			this.render();
			return;
		}
		if (stale.length > 0) {
			grid.repaintCells(recordId, stale, record);
		}
		if (view.type !== 'grid') {
			return;
		}
		if (colorRulesOf(view).length > 0) {
			grid.recolorRow(record);
		}
		const summaries = view.summaries ?? {};
		if ([...touched].some((id) => summaries[id] !== undefined)) {
			grid.refillFoot();
		}
	}

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

export function createLayerView(
	leaf: WorkspaceLeaf,
	plugin: LayerBasePlugin,
): LayerView {
	return new LayerView(leaf, plugin);
}

function noteTarget(path: string): string {
	return path.endsWith('.md') ? path : `${path}.md`;
}

/* Lists join with commas and a nested object answers null: a cell has room for one
 * line, and saying it cannot be read beats a blank that looks like a value. */
function frontmatterText(raw: unknown): string | null {
	if (raw === null || raw === undefined) {
		return '';
	}
	if (Array.isArray(raw)) {
		const parts: string[] = [];
		for (const item of raw) {
			const text = frontmatterText(item);
			if (text === null) {
				return null;
			}
			if (text !== '') {
				parts.push(text);
			}
		}
		return parts.join(', ');
	}
	if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
		return String(raw);
	}
	return null;
}

/** A checkbox or a slider has no text to take back, so the table keeps the key there. */
function isTextEntry(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	if (target.isContentEditable) {
		return true;
	}
	if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
		return true;
	}
	if (target.tagName !== 'INPUT') {
		return false;
	}
	const type = (target as HTMLInputElement).type;
	return !['button', 'checkbox', 'color', 'file', 'radio', 'range', 'submit'].includes(type);
}
