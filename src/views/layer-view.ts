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
import {readsFromView} from '../model/capabilities';
import {computeFormulaWithReader, type FormulaValue} from '../model/formula';
import {aggregateRollup, type RollupValue} from '../model/rollup';
import {numberTexts} from '../model/numbering';
import {noteLabel} from '../model/note-path';
import {csvFileName, toCsv} from '../model/csv';
import {sortRecords} from '../model/sort';
import {filterRecords} from '../model/filter';
import {formulaErrorShort, formulaErrorMessage} from '../ui/formula-text';
import {
	relationBackIndex,
	relationBackRows,
	type BacklinkRow,
	lookupChips,
	relationCandidates as candidatesOf,
	relationText as textOf,
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

export class LayerView extends TextFileView {
	private doc: LayerDoc | null = null;
	/** The format version of a file this build refuses to read, if this is one. */
	private unsupported: number | null = null;
	/** That file's text, so a save writes back exactly what was read. */
	private unsupportedText = '';
	/** The text handed to the file on the last save, to recognise its echo. */
	private lastSaved = '';
	/** The text this view believes the file on disk holds. */
	private lastDisk = '';
	/** A change this view holds that the file has not taken yet. */
	private unsaved = false;
	/** Text that arrived from outside while `unsaved` was true. */
	private pendingExternal: string | null = null;
	private activeViewId: string | null = null;
	private selection: GridSelection | null = null;
	private rangeSize: RangeSize | null = null;
	private readonly history = new History();
	/** The copy taken before an edit, waiting to be recorded once it lands. */
	private pendingEdit: { label: string; before: Snapshot } | null = null;
	/** How deep a cell is being read through other tables; stops a cycle. */
	private readDepth = 0;
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
	/**
	 * The number each row shows, per numbering column, for the current render pass.
	 *
	 * Counted once rather than per cell: the count walks every row in the group, and
	 * asking that per cell would make a table cost its own square.
	 */
	private readonly numbers = new Map<string, Map<string, string>>();
	/** A repaint is already scheduled, so a burst of changes paints once. */
	private repaintQueued = false;
	/** Guards a redraw so a commit that triggers one cannot re-enter it. */
	private readonly redraw = {busy: false};
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
		this.lastSaved = '';
		this.lastDisk = '';
		this.unsaved = false;
		this.pendingExternal = null;
		// Another file is another document: steps taken in the old one must not be
		// replayed onto this one.
		this.history.clear();
		await super.onLoadFile(file);
	}

	onload(): void {
		super.onload();
		/*
		 * Undo and redo belong to this view, so they are bound to a scope of its own that
		 * sits on the key stack only while the view has focus. Binding them as a
		 * command's default hotkey did not work out: a hotkey is global, and Obsidian
		 * takes the key before it decides the command is unavailable — so Ctrl+Z in a
		 * note stopped reaching the editor.
		 */
		this.registerUndoScope();

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
		if (this.unsupported !== null) {
			/*
			 * A file this build cannot read is handed back exactly as it arrived.
			 * Anything else — the empty string, or a document rebuilt from what this
			 * build understands — would be a write that loses data the moment the
			 * base class saves.
			 */
			return this.unsupportedText;
		}
		if (!this.doc) {
			return '';
		}
		const text = serializeLayerDoc(this.doc);
		// Remembered so the file echoing this save can be told from a real outside
		// change. Comparing the stored document instead would not work: reading a file
		// normalises it — a primary flag added, a created stamp filled in — so the
		// text that comes back is never byte-equal to what the document would write.
		this.lastSaved = text;
		return text;
	}

	/**
	 * Saves this view, unless the file on disk changed while an edit was pending.
	 *
	 * `TextFileView` saves on a two-second debounce, so an outside write — the MCP
	 * server, a sync client, another editor — can land after the edit but before
	 * this call. Overwriting it would lose that write silently. The local document
	 * is copied beside the table instead, the outside version becomes the file,
	 * and the reader is told where their copy went.
	 */
	async save(clear = false): Promise<void> {
		const file = this.file;
		const local =
			this.doc === null
				? this.unsupported !== null
					? this.unsupportedText
					: ''
				: serializeLayerDoc(this.doc);
		if (file !== null && local !== '' && this.lastDisk !== '') {
			let disk: string | null = null;
			try {
				disk = await this.app.vault.read(file);
			} catch {
				// A file that cannot be read now is left to the base class, whose
				// save reports the failure instead of inventing a conflict.
				disk = null;
			}
			if (disk !== null && disk !== this.lastDisk && disk !== local) {
				this.pendingExternal = disk;
				this.unsaved = true;
			}
		}

		const incoming = this.pendingExternal;
		if (incoming !== null) {
			if (local !== '' && file !== null) {
				try {
					const copy = await this.plugin.store.writeConflictCopy(file, local);
					new Notice(t().noticeConflictSaved(copy.path));
				} catch (error) {
					console.error('[layer-base] Could not save a conflict copy:', error);
					new Notice(t().noticeConflictFailed);
					return;
				}
			}
			this.pendingExternal = null;
			this.unsaved = false;
			// The outside version is the one that stays on disk; show it now.
			this.setViewData(incoming, false);
			return;
		}

		await super.save(clear);
		if (!clear) {
			this.lastDisk = local;
			this.unsaved = false;
		}
	}

	setViewData(data: string, _clear: boolean): void {
		/*
		 * Whether this is the file echoing our own save. Two tests, either of which is
		 * enough:
		 *
		 * 1. The text is exactly what we last wrote.
		 * 2. Reading the text yields the rows and columns we already hold — the same
		 *    change said differently, which happens when the write is normalised on the
		 *    way to disk.
		 *
		 * Both are needed because clearing the undo steps is destructive: a wrong
		 * "this came from outside" throws away everything the reader could have taken
		 * back, and it is invisible when it happens.
		 */
		if (this.lastSaved !== '' && data === this.lastSaved) {
			this.lastSaved = '';
			this.lastDisk = data;
			return;
		}

		// An edit still open in a cell lives in the DOM, not the document. It has
		// to reach the document before an outside version is compared with it.
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
		 * An outside write arrived while this view holds an edit the file has not
		 * taken yet. Keep the local document on screen; save() will copy it aside
		 * and adopt the outside version, so neither side is lost.
		 */
		if (data !== '' && this.doc !== null && this.unsaved) {
			if (this.pendingExternal === null) {
				new Notice(t().noticeExternalChangePending);
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
		/*
		 * The document was replaced from outside — synced in, or edited elsewhere. The
		 * steps recorded against the previous contents no longer describe it, and
		 * replaying one would write stale rows over what just arrived.
		 */
		this.history.clear();

		if (warnings.length > 0) {
			new Notice(t().noticeParseWarnings(warnings.length));
			console.warn(
				`[layer-base] Repaired ${warnings.length} issue(s) while reading "${this.file?.path ?? 'unknown'}":`,
				warnings,
			);
		}

		if (dropped.length > 0) {
			/*
			 * A value that was there is gone now, so the reader gets the column and the
			 * value itself rather than a count: that is what they would have to put
			 * back. Shown longer than a passing note, since it is a loss.
			 */
			new Notice(t().noticeCellsCleared(dropped), 12000);
			console.warn(
				`[layer-base] Cleared ${dropped.length} cell(s) that held a value their column cannot take, in "${this.file?.path ?? 'unknown'}":`,
				dropped,
			);
		}

		this.render();
	}

	clear(): void {
		this.doc = null;
		this.unsupported = null;
		this.unsupportedText = '';
		this.lastSaved = '';
		this.lastDisk = '';
		this.unsaved = false;
		this.pendingExternal = null;
		this.contentEl.empty();
	}
	/**
	 * Applies an edit to the in-memory document and asks Obsidian to persist it.
	 *
	 * A label marks the edit as one worth being able to undo, and names the kind so a
	 * run of the same kind collapses into one step. Edits that leave the data alone —
	 * a column widened, a filter changed — pass no label and never take a step.
	 */
	markDirty(): void {
		if (!this.doc) {
			return;
		}
		this.unsaved = true;
		this.requestSave();
	}

	/**
	 * Takes a copy of the data before an edit, for undoing it later.
	 *
	 * Called before the change is made, because the copy has to hold the table as it
	 * was. An edit that turns out to change nothing never calls `commitEdit`, so no
	 * step is left behind for a delete that matched no rows.
	 */
	private beginEdit(label: string): string {
		this.pendingEdit = this.doc
			? { label, before: this.history.snapshot(this.doc) }
			: null;
		return label;
	}

	/** Records the copy taken by `beginEdit`, now that the edit has happened. */
	private commitEdit(): void {
		const pending = this.pendingEdit;
		this.pendingEdit = null;
		if (!pending) {
			return;
		}
		this.history.push(pending.label, pending.before);
		this.markDirty();
	}

	/** Takes one edit back, for the plugin's command. */
	runUndo(): void {
		this.handleUndo();
	}

	/** Puts back what the last undo took back, for the plugin's command. */
	runRedo(): void {
		this.handleRedo();
	}

	/**
	 * Puts undo and redo on the key stack while this view has focus, and takes them off
	 * again when it does not.
	 *
	 * A scope of the view's own rather than the view's `this.scope`: that property is
	 * null until something creates a scope, and a binding made against it never fires.
	 * Push and pop matter as much as the binding — a scope left on the stack would keep
	 * swallowing the key for every other tab.
	 */
	private registerUndoScope(): void {
		const scope = new Scope(this.app.scope);
		/*
		 * A text field keeps an undo of its own, over the characters being typed. Taking
		 * the key there left the text alone and took back an earlier row instead, which
		 * is not what someone halfway through editing a cell is asking for. Handing the
		 * key back is enough for the browser to do its own thing.
		 */
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

		// Focus is what decides ownership: the view that was last clicked owns the key,
		// and a view that merely exists in a background tab owns nothing.
		const ledger = scopeLedger(
			scope,
			(inner) => this.app.keymap.pushScope(inner),
			(inner) => this.app.keymap.popScope(inner),
		);
		// A click fires `pointerdown`, and the first one also fires `focusin`: the
		// ledger turns that pair into one scope on the stack.
		this.registerDomEvent(this.contentEl, 'focusin', () => ledger.acquire());
		this.registerDomEvent(this.contentEl, 'pointerdown', () => ledger.acquire());
		this.registerDomEvent(this.contentEl, 'focusout', (event) => {
			// Only when focus leaves the view entirely, not when it moves between two
			// cells inside it.
			const next = event.relatedTarget as Node | null;
			if (next && this.contentEl.contains(next)) {
				return;
			}
			/*
			 * An editor that ends takes its input out of the page, and the browser
			 * drops the focus to nowhere instead of handing it on. Releasing there
			 * took undo with it: the table still looked active but stopped answering
			 * the key until it had been clicked again.
			 */
			if (!next) {
				return;
			}
			ledger.release();
		});
		/*
		 * Keeping the scope through "the focus went nowhere" means a press anywhere
		 * else has to give it up, or the key would stay swallowed while another pane
		 * is in use. Inside the view the press is what the ledger acquires on.
		 */
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

	/** Takes one edit back. */
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

	/** Puts back what was taken back. */
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

	/**
	 * Replaces the rows and columns, leaving the views alone.
	 *
	 * The views are the reader's current way of looking at the table; undoing a row's
	 * deletion should not also put a column width or a filter back. Saving is asked
	 * for without a label, so the restoration is not itself a step to undo.
	 */
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

	/**
	 * Whether the text just read gives the document already held.
	 *
	 * Compared as a whole: a rename of the document or of a view, a changed filter or
	 * a board setting is the reader's too. Reading one of those as an echo of our own
	 * save is what threw the incoming copy away and then wrote ours back over it.
	 */
	private sameContent(incoming: LayerDoc): boolean {
		const doc = this.doc;
		return doc !== null && sameDocument(incoming, doc);
	}

	/**
	 * Leaves a file written by a newer build closed, holding its text unchanged.
	 *
	 * The document is dropped rather than replaced with an empty one: an empty board
	 * would be an editable table, and every edit would be a write over data this
	 * build does not understand.
	 */
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

	getDocument(): LayerDoc | null {
		return this.doc;
	}

	/**
	 * Opens the note a value names, making the file when the vault has none.
	 *
	 * Creating rather than refusing is the point of the field: a path typed into a cell
	 * says where a note should live, and an empty note that opens is more useful than an
	 * error that leaves the reader to make it by hand.
	 */
	private openNotePath(path: string): void {
		const existing = this.resolveNote(path);
		if (existing) {
			this.showFile(existing);
			return;
		}
		const target = noteTarget(path);
		void this.createNote(target, path);
	}

	/**
	 * Shows the file, reusing the tab that already holds it.
	 *
	 * A new tab rather than this one: the table is what the reader was looking at, and
	 * replacing it would cost them their place. Reusing an open tab keeps repeated
	 * clicks from stacking copies of the same note.
	 */
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

	/** Makes the note, reporting what happened, and answers the file or null. */
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

	/** Makes every folder along a path, so a note can land where none exists yet. */
	private async ensureFolder(path: string): Promise<void> {
		let current = '';
		for (const part of path.split('/')) {
			current = current === '' ? part : `${current}/${part}`;
			if (!this.app.vault.getAbstractFileByPath(current)) {
				await this.app.vault.createFolder(current);
			}
		}
	}

	/**
	 * The file a stored value names.
	 *
	 * A path is written by hand as often as it is picked, so every form a link may take
	 * is tried — with and without the extension, and finally as a link that resolves
	 * against the vault rather than the filesystem.
	 */
	private resolveNote(path: string): TFile | null {
		for (const candidate of [path, `${path}.md`]) {
			const file = this.app.vault.getAbstractFileByPath(candidate);
			if (file instanceof TFile) {
				return file;
			}
		}
		return this.app.metadataCache.getFirstLinkpathDest(path, '');
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
			new Notice(t().noticeExportDone(written.path));
		} catch (error) {
			new Notice(t().noticeExportFailed);
			console.error('[layer-base] Failed to export CSV:', error);
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
			// The file is for a spreadsheet, so a value one would evaluate is written as
			// text rather than left to run when the file is opened.
			text: toCsv(header, rows, {guardFormulas: true}),
			/*
			 * The base name only: the dialog shows it as a name and the writer adds
			 * `.csv`, so a reader never ends up with a file called `x.csv.csv`.
			 */
			name: csvFileName(doc.name).replace(/\.csv$/, ''),
		};
	}

	private render(): void {
		/*
		 * A redraw replaces the tree an open editor lives in, and the editor's text is
		 * still in the DOM rather than the document. So the edit is committed first or
		 * it is lost — and a commit can itself ask for a redraw, which `redrawOnce`
		 * folds into this one pass.
		 */
		redrawOnce(
			this.redraw,
			() => this.commitOpenEdit(),
			() => this.draw(),
		);
	}

	/**
	 * Draws the view from the current document.
	 *
	 * Go through `render()` instead of calling this: it ends any open edit first, so
	 * the text the reader typed is not thrown away with the tree this rebuilds.
	 */
	private draw(): void {
		/*
		 * Where the table was scrolled to, read before the tree is torn down. The
		 * renderer is built fresh on every redraw, so it cannot carry this itself: the
		 * instance that knows the offset is the one being discarded.
		 */
		const offset = this.grid?.offset() ?? { left: 0, top: 0 };

		// The reverse lookups belong to the tree about to be thrown away.
		this.backIndexes.clear();
		this.backRows.clear();
		this.numbers.clear();
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

	/**
	 * The row's position in the view, not in the file.
	 *
	 * The numbers beside the table count what is on screen, so the label has to
	 * count the same way: once the view is sorted or filtered, the file's own order
	 * points at a row the reader cannot see.
	 */
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

	/** Appends a row and re-renders so it appears immediately. */
	private handleAddRecord(): void {
		if (!this.doc) {
			return;
		}
		this.beginEdit('add-record');
		addRecord(this.doc);
		this.commitEdit();
		this.render();
	}

	/** Inserts a row above everything else. */
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

		// A field edit can add a column or change a type, which clears the column,
		// so the whole application is one step to take back.
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
			this.applyLookupSettings(field, result.lookup);
			this.applyFormulaSettings(field, result.formula, result.formulaType);
			this.applyNotePropSettings(field, result.noteProp);
			this.applyBackSettings(field, result.back);
			written = field;
		}

		// The panel stops offering the flag for a column the table fills in itself,
		// so this is a guard rather than the mechanism: a flag that never fires
		// would leave the reader waiting for a warning that is not coming.
		if (!canBeRequired(written.type)) {
			delete written.required;
		}

		this.commitEdit();
		this.render();
	}

	/**
	 * Writes a numbering column's padding and grouping.
	 *
	 * Nothing is numbered here: the number is counted from the row order as the
	 * table is drawn, so changing either setting changes what every cell reads
	 * without touching a single row.
	 */
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
	}

	/** Writes a lookup's two settings. Like a rollup, it stores no values. */
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

	/** Inserts as many blank rows as were asked for, below the given one. */
	private handleInsertRecordsBelow(recordId: string, count: number): void {
		if (!this.doc || count < 1) {
			return;
		}
		this.beginEdit('insert-records');
		insertRecordsAfter(this.doc, recordId, count);
		this.commitEdit();
		this.render();
	}

	/** Copies the selected rows, each copy landing below its source. */
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
		// Removed rather than stored as 'none', so a column that was never touched
		// leaves no entry in the file.
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

	/**
	 * Opens the height list beside the button that asked for it.
	 *
	 * Only a table has rows to set a height for, so only a table is offered it.
	 */
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

	/**
	 * Puts every row on one height.
	 *
	 * This is also the undo for a dragged row: choosing a height says something
	 * about the whole table, so the rows that were dragged away come back.
	 */
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

	/** Opens the colour rules beside the button that asked for them. */
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

	/**
	 * The wash this row wears, resolved the same way the filter resolves a row.
	 *
	 * Both answers have to come from the same place: a colour rule that disagreed
	 * with the filter about what a cell says would tint rows the filter had just
	 * hidden, or leave plain ones it kept.
	 */
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

	/** Empties the selected rectangle. */
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

	/** Empties a row's cells but keeps the row itself. */
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
			isGrid: view.type === 'grid',
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
		const doc = this.doc;
		if (doc === null) {
			return [];
		}
		return this.relationTextIn(doc, field, value).chips ?? [];
	}

	private orderedRecords(doc: LayerDoc, view: View | null): readonly LayerRecord[] {
		// Filtering first, then ordering: sorting rows that are about to be hidden is
		// work nobody sees, and it keeps "the visible rows" as one idea.
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

	/**
	 * What a cell reads as when two rows are compared: filtering, ordering, tinting.
	 *
	 * A note column shows the file's name or its path, by the reader's setting, so
	 * comparing has to follow that text — a list sorted by a path nobody sees would
	 * disagree with the column beside it. Copying and the CSV export still carry the
	 * path, because a copied cell has to be the value the file holds.
	 */
	private compareTextOf(field: Field, record: LayerRecord): string | null {
		if (field.type === 'note') {
			const value = record.cells[field.id] ?? '';
			return typeof value === 'string'
				? noteLabel(value, this.plugin.settings.noteLabel)
				: '';
		}
		return this.cellTextOf(field, record);
	}

	/**
	 * Reads a cell the document cannot read by itself.
	 *
	 * A note property lives in another file; a relation stores row ids and the names
	 * are in another table; a computed column stores nothing at all. Answering null
	 * leaves every other type to the plain rules, so this switch is the whole of
	 * "this column needs the view".
	 *
	 * `doc` is the table the cell belongs to, which is not always the open one: a
	 * lookup reads a column of the table it points at, and that column may itself be
	 * a formula. Taking the document as an argument is what lets one answer serve
	 * every table — the open one and the ones it points at.
	 */
	private cellTextIn(
		doc: LayerDoc,
		field: Field,
		record: LayerRecord,
	): string | null {
		/*
		 * Two tables can point at each other, and a formula that reads a lookup into
		 * the table pointing back would otherwise ask forever. Past a few hops the
		 * answer falls back to the stored value, which is what a column that cannot be
		 * read shows anyway.
		 */
		if (this.readDepth > 8) {
			return null;
		}
		this.readDepth += 1;
		try {
			return this.readCellTextIn(doc, field, record);
		} finally {
			this.readDepth -= 1;
		}
	}

	private readCellTextIn(
		doc: LayerDoc,
		field: Field,
		record: LayerRecord,
	): string | null {
		switch (field.type) {
			case 'noteProp':
				return this.notePropValueIn(doc, field, record.id);
			case 'autoNumber':
				return this.autoNumberTextIn(doc, field, record.id);
			case 'relation':
				return this.relationTextIn(doc, field, record.cells[field.id] ?? '')
					.text;
			case 'relationBack':
				return this.backTextIn(doc, field, record.id).text;
			case 'formula':
				return this.formulaTextIn(doc, field, record.id).text;
			case 'rollup':
				return this.rollupTextIn(doc, field, record.id).text;
			case 'lookup':
				return this.lookupTextIn(doc, field, record.id).text;
			default:
				// Every stored type is read by the document itself.
				return null;
		}
	}

	/** The same question, asked of the table that is open. */
	private cellTextOf(field: Field, record: LayerRecord): string | null {
		const doc = this.doc;
		return doc === null ? null : this.cellTextIn(doc, field, record);
	}

	/**
	 * How another table's cells read, for the columns that table cannot read itself.
	 *
	 * The same answer this table's cells get, asked of the table they live in. That
	 * is what lets a relation show a formula, a lookup show a rollup and a backlink
	 * title a numbering column — one answer, every table.
	 */
	private readerIn(doc: LayerDoc): CellReader {
		return (field, record) =>
			this.cellTextIn(doc, field, record) ??
			formatCell(field, record.cells[field.id] ?? '');
	}

	/**
	 * What one cell reads as, whoever is asking.
	 *
	 * The grid and the CSV export both come through here, so what is written to a
	 * file cannot disagree with what the screen showed. One question, asked of one
	 * switch: `cellTextOf` answers the types that need the view, and everything
	 * else reads its own stored value.
	 */
	private displayText(field: Field, record: LayerRecord): string {
		const read = this.cellTextOf(field, record);
		if (read !== null) {
			return read;
		}
		return formatCell(field, record.cells[field.id] ?? emptyValueFor(field));
	}

	/**
	 * Stores where a note property reads from.
	 *
	 * Both parts are removed when the type is anything else, so a column that stopped
	 * being a note property does not keep pointing into someone's frontmatter.
	 */
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

	/** The cell reading of a note property, in the shape the grid asks for. */
	/** The same answer for the table that is open. */
	private notePropValue(field: Field, recordId: string): string {
		const doc = this.doc;
		return doc === null ? '' : this.notePropValueIn(doc, field, recordId);
	}

	private notePropText(field: Field, recordId: string): CellText {
		return { text: this.notePropValue(field, recordId), broken: 0 };
	}

	/**
	 * The value a note property row reads.
	 *
	 * It is not in this document: it lives in the frontmatter of the note the row's note
	 * column names. A row with no note, a note that is not there, or a note without that
	 * key all read as nothing, which is what an empty cell already means.
	 */
	private notePropValueIn(
		doc: LayerDoc,
		field: Field,
		recordId: string,
	): string {
		const record = findRecord(doc, recordId);
		if (!record) {
			return '';
		}
		const source = doc.fields.find((candidate) => candidate.id === field.noteFieldId);
		if (!source || source.type !== 'note') {
			return '';
		}
		const path = record.cells[source.id];
		if (typeof path !== 'string' || path === '') {
			return '';
		}
		const file = this.resolveNote(path);
		if (!file) {
			return '';
		}
		const key = field.frontmatterKey ?? field.name;
		return frontmatterText(this.app.metadataCache.getFileCache(file)?.frontmatter?.[key]);
	}

	/**
	 * Writes a value into the note a row names, making the note when it is missing.
	 *
	 * Deliberately outside the undo steps: those hold a copy of this document, and the
	 * value being changed lives in another file. An undo would restore the table and
	 * leave the note as it now is.
	 */
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

	/**
	 * What a formula row computes to.
	 *
	 * The columns are re-read from the open document rather than trusted from the
	 * cell that asked: the grid was built from an earlier render, and a formula
	 * must read the values as they are now.
	 */
	private formulaTextIn(doc: LayerDoc, field: Field, recordId: string): CellText {
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
		const result = computeFormulaWithReader(doc, record, target, (other) =>
			this.formulaCellValueIn(doc, other, record, recordId),
		);
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

	/** The same answer for the table that is open. */
	private formulaText(field: Field, recordId: string): CellText {
		const doc = this.doc;
		return doc === null
			? {text: '', broken: 0}
			: this.formulaTextIn(doc, field, recordId);
	}

	/**
	 * What one column hands a formula.
	 *
	 * Asked only for the columns the document cannot read on its own: a relation
	 * keeps row ids where the grid shows names, and a lookup, rollup, reverse
	 * relation, note property or numbering keeps nothing at all. Every other type
	 * answers `undefined` and is read from its stored cell — which matters, because
	 * a number column must arrive as a number or `+` would join it as text instead
	 * of adding it.
	 *
	 * A rollup's total goes back to being a number for that same reason: on screen
	 * it is dressed text, but a formula that adds to it means arithmetic.
	 *
	 * A numbering cell answers with the padded text the cell shows, not with the
	 * bare number: what a reader builds from it is an identifier — `{Module}-{No}`
	 * has to read `MOD-01`, not `MOD-1` — and `{No} * 1` is there for the rare
	 * formula that means arithmetic.
	 */
	private formulaCellValueIn(
		doc: LayerDoc,
		field: Field,
		record: LayerRecord,
		recordId: string,
	): FormulaValue | undefined {
		switch (field.type) {
			case 'relation':
				return this.relationTextIn(doc, field, record.cells[field.id] ?? '')
					.text;
			case 'relationBack':
				return this.backTextIn(doc, field, recordId).text;
			case 'lookup':
				return this.lookupTextIn(doc, field, recordId).text;
			case 'autoNumber':
				return this.autoNumberTextIn(doc, field, recordId);
			case 'rollup': {
				const answer = this.rollupAnswerIn(doc, field, record, recordId);
				if (answer === null) {
					return '';
				}
				return answer.kind === 'number' ? Number(answer.text) : answer.text;
			}
			case 'noteProp':
				return this.notePropValueIn(doc, field, recordId);
			default:
				return undefined;
		}
	}

	/**
	 * What a numbering cell reads: its position within its group, padded.
	 *
	 * Counted for the whole column at once and kept for this render pass, because
	 * the count walks every row of the group — asking that per cell would make the
	 * table cost its own square.
	 */
	private autoNumberTextIn(
		doc: LayerDoc,
		field: Field,
		recordId: string,
	): string {
		let texts = this.numbers.get(field.id);
		if (!texts) {
			// The live column, not the copy the paint was handed, so a setting
			// changed since the tree was built cannot be counted with.
			const target = doc.fields.find((other) => other.id === field.id) ?? field;
			texts = numberTexts(doc, target);
			this.numbers.set(field.id, texts);
		}
		return texts.get(recordId) ?? '';
	}

	/** The same answer for the table that is open. */
	private autoNumberText(field: Field, recordId: string): string {
		const doc = this.doc;
		return doc === null ? '' : this.autoNumberTextIn(doc, field, recordId);
	}

	/** The same reading in the shape the grid asks for: a number, so it lines up. */
	private autoNumberCellText(field: Field, recordId: string): CellText {
		return {text: this.autoNumberText(field, recordId), broken: 0, kind: 'number'};
	}

	/**
	 * What a rollup gathered from the rows this row is linked to.
	 */
	private rollupTextIn(doc: LayerDoc, field: Field, recordId: string): CellText {
		const record = findRecord(doc, recordId);
		if (!record) {
			return {text: '', broken: 0};
		}
		const answer = this.rollupAnswerIn(doc, field, record, recordId);
		if (answer === null) {
			return {text: '', broken: 0};
		}
		return {text: answer.text, broken: 0, kind: answer.kind};
	}

	/**
	 * The total a rollup reached, before it is dressed for the cell.
	 *
	 * Null covers both "this column is not set up" and "the other table cannot be
	 * read": either way the column has nothing to show, and neither is an error.
	 */
	private rollupAnswerIn(
		doc: LayerDoc,
		field: Field,
		record: LayerRecord,
		recordId: string,
	): RollupValue | null {
		const target = doc.fields.find((candidate) => candidate.id === field.id);
		if (!target) {
			return null;
		}
		const sourceField = doc.fields.find(
			(candidate) => candidate.id === target.rollupSourceFieldId,
		);
		// Not configured yet, or pointing at a column that is gone: a column waiting
		// to be set up reads as empty, not as a failure in every row.
		if (!sourceField || !target.rollupFieldId) {
			return null;
		}
		const gathered = this.gatheredValuesIn(
			doc,
			sourceField,
			target.rollupFieldId,
			record,
			recordId,
		);
		if (gathered === null) {
			return null;
		}
		return aggregateRollup(
			gathered.map((entry) => entry.text ?? entry.value),
			target.rollupAggregate ?? 'sum',
		);
	}

	/** The same answer for the table that is open. */
	private rollupText(field: Field, recordId: string): CellText {
		const doc = this.doc;
		return doc === null
			? {text: '', broken: 0}
			: this.rollupTextIn(doc, field, recordId);
	}

	/**
	 * What a lookup read from the rows this row is linked to.
	 *
	 * One chip per value, in the order the link lists the rows. Values that repeat
	 * stay repeated: dropping one would silently forget that a linked row exists.
	 * Nothing about it is stored, so it cannot go stale when the other table moves.
	 */
	private lookupTextIn(doc: LayerDoc, field: Field, recordId: string): CellText {
		const record = findRecord(doc, recordId);
		const target = doc.fields.find((candidate) => candidate.id === field.id);
		if (!record || !target) {
			return {text: '', broken: 0};
		}
		const sourceField = doc.fields.find(
			(candidate) => candidate.id === target.lookupSourceFieldId,
		);
		const columnId = target.lookupFieldId ?? '';
		// Not set up yet, or pointing at a column that is gone: an unconfigured
		// column reads as empty, not as a failure in every row.
		if (!sourceField || columnId === '') {
			return {text: '', broken: 0};
		}
		const other =
			sourceField.type === 'relation'
				? this.targetDoc(sourceField, doc)
				: this.sourceDoc(sourceField, doc);
		const gathered = this.gatheredValuesIn(
			doc,
			sourceField,
			columnId,
			record,
			recordId,
		);
		if (!other || gathered === null) {
			return {text: '', broken: 0};
		}
		/*
		 * Read through the formatter of the column the values came from, not
		 * through a link reader: a gathered value is the value itself, while a
		 * link reader expects a cell holding a list of row ids and answers
		 * with nothing for anything else.
		 */
		const column = other.fields.find(
			(candidate) => candidate.id === columnId,
		);
		if (!column) {
			return {text: '', broken: 0};
		}
		const chips = lookupChips(
			column,
			gathered.map((entry) => entry.value),
			(linked, value) =>
				this.relationTextIn(other, linked, value).chips ?? [],
			gathered.map((entry) => entry.text),
		);
		return {text: chips.join(', '), broken: 0, chips};
	}

	/** The same answer for the table that is open. */
	private lookupText(field: Field, recordId: string): CellText {
		const doc = this.doc;
		return doc === null
			? {text: '', broken: 0}
			: this.lookupTextIn(doc, field, recordId);
	}

	/**
	 * The values a rollup reduces, or null when the other table cannot be read.
	 *
	 * Null is not the same as an empty list: an empty list means the other table was
	 * read and had nothing to contribute, which a count answers as zero.
	 */
	private gatheredValuesIn(
		doc: LayerDoc,
		sourceField: Field,
		columnId: string,
		record: LayerRecord,
		recordId: string,
	): readonly {value: CellValue; text: string | null}[] | null {
		if (sourceField.type === 'relation') {
			const other = this.targetDoc(sourceField, doc);
			if (!other) {
				return null;
			}
			return relationIds(record.cells[sourceField.id] ?? '').map((id) =>
				this.gatheredIn(other, columnId, findRecord(other, id)),
			);
		}

		if (sourceField.type === 'relationBack') {
			const other = this.sourceDoc(sourceField, doc);
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
			return (rows.get(recordId) ?? []).map((row) =>
				this.gatheredIn(other, columnId, row.record),
			);
		}

		// A source column that is neither kind is a configuration this column cannot
		// answer, so it reads as empty rather than guessing at a direction.
		return null;
	}

	/**
	 * One gathered value, plus the text to use when that column computes it.
	 *
	 * `text` is null for every column that stores what it shows, so the caller reads
	 * the stored value — a number column has to stay a number or a total stops being
	 * arithmetic. A computed column has nothing stored, so what its cell reads as is
	 * all there is; without this, a lookup or rollup over a formula gathered blanks.
	 */
	private gatheredIn(
		doc: LayerDoc,
		columnId: string,
		record: LayerRecord | undefined,
	): {value: CellValue; text: string | null} {
		if (!record) {
			return {value: '', text: null};
		}
		const stored = record.cells[columnId] ?? '';
		const column = doc.fields.find((candidate) => candidate.id === columnId);
		if (!column || !readsFromView(column.type)) {
			return {value: stored, text: null};
		}
		return {value: stored, text: this.cellTextIn(doc, column, record) ?? ''};
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
		const target = this.targetDoc(field, doc);
		if (!target) {
			return {text: '', broken: relationIds(value).length};
		}
		const resolved = textOf(
			target,
			field.linkFieldId ?? '',
			value,
			this.readerIn(target),
		);
		return {
			text: resolved.texts.join(', '),
			broken: resolved.broken,
			chips: resolved.texts,
		};
	}

	/** The same answer for the table that is open. */
	private relationText(field: Field, value: CellValue): CellText {
		const doc = this.doc;
		return doc === null
			? {text: '', broken: relationIds(value).length}
			: this.relationTextIn(doc, field, value);
	}

	/** What a reverse relation row shows: the rows elsewhere that point at it. */
	private backTextIn(doc: LayerDoc, field: Field, recordId: string): CellText {
		const source = this.sourceDoc(field, doc);
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
				this.readerIn(source),
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

	/** The same answer for the table that is open. */
	private backText(field: Field, recordId: string): CellText {
		const doc = this.doc;
		return doc === null ? {text: '', broken: 1} : this.backTextIn(doc, field, recordId);
	}

	/**
	 * The table a reverse relation reads: the one whose rows point back here.
	 *
	 * `doc` is the table the column asking is in, used when the column names no table
	 * of its own — a reverse relation inside one table.
	 *
	 * Resolved the same way a forward link is, including the filename fallback,
	 * and repaired the same way when it turns out to have moved.
	 */
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
		this.beginEdit('cell');
		if (!setCellValue(doc, recordId, field, value)) {
			this.pendingEdit = null;
			return;
		}
		this.commitEdit();
		this.render();
	}

	/**
	 * Opens the panel that chooses this board's columns.
	 *
	 * Reported on save rather than on every keystroke: the choice changes the whole
	 * board, and applying it as each box is ticked would redraw under the reader's
	 * cursor.
	 */
	/**
	 * Opens the panel for whatever this view's columns mean.
	 *
	 * A table hides and shows columns; a board chooses the grouping column, the card's
	 * title and what a card carries. One button, because both answer the same question
	 * — what does this view show.
	 */
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

	/**
	 * Hides or shows a column, rejecting the last visible one.
	 *
	 * The rule lives in the model, so the panel and any other caller agree on what a
	 * table may be reduced to.
	 */
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
			// Only a refusal is worth telling the reader about: a column already in
			// the state asked for changed nothing, and it was not turned down.
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

	/**
	 * Adds a board view and switches to it.
	 *
	 * The table is left as it is: a board is another way of looking at the same
	 * rows, so adding one changes nothing about the data.
	 */
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

	/** Renames a view, which is only ever a change to the tab. */
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

	/**
	 * Removes a view and picks another to show.
	 *
	 * The view being removed may be the active one, so a neighbour is chosen before
	 * the redraw: otherwise the table would fall back to the first view and lose
	 * the reader's place.
	 */
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
		// Said out loud rather than failing quietly: the menu greys the item out, but
		// a keyboard or a stale menu can still reach this.
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
		/*
		 * A note property is answered by another file, so an edit belongs there and not
		 * in this document. Answered before the copy is taken: nothing here changes, so
		 * there is no step to take back.
		 */
		if (field.type === 'noteProp') {
			this.writeNoteProp(field, recordId, value);
			return;
		}
		// The copy is taken first: it has to hold the table before the edit.
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

	/**
	 * Redraws whatever an edit made stale, and as little of it as it can.
	 *
	 * The grid repaints the one cell it edited, which is right for a value nothing
	 * else reads. A value that is read — by the columns beside it, by a colour rule,
	 * by the totals under it, by the filter — is another matter: those keep showing
	 * the answer from before the edit unless they are drawn again here.
	 *
	 * Two paths. If an affected column takes part in the order or the filter, the
	 * row can move or leave, and only a whole redraw can show that. Otherwise the
	 * row stays where it is, and its cells, its wash and the totals are drawn again
	 * in place, keeping the selection and the scroll position a redraw would drop.
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
		/*
		 * A numbering column counted within the edited one changes for every row in
		 * both groups, not just this one, so a single row cannot be patched.
		 */
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

export function createLayerView(
	leaf: WorkspaceLeaf,
	plugin: LayerBasePlugin,
): LayerView {
	return new LayerView(leaf, plugin);
}

/**
 * JSON with the keys in a fixed order, for comparing two values by content.
 *
 * Object key order is not meaningful but does reach the serialised text, so two
 * equal documents can stringify differently. Sorting makes the comparison answer the
 * question actually being asked — is this the same data — rather than whether two
 * writers happened to emit keys in the same order.
 */
/**
 * Whether a key pressed in this element belongs to a text field rather than the table.
 *
 * The distinction matters for undo: in a field the browser already remembers the
 * characters typed there, and that is the history someone wants while editing. A
 * checkbox or a slider has no text to take back, so the table keeps the key there.
 */
/** The file path a stored note value names, with the extension the vault expects. */
function noteTarget(path: string): string {
	return path.endsWith('.md') ? path : `${path}.md`;
}

/**
 * How a frontmatter value reads in a cell.
 *
 * Lists join with commas, scalars print as they are, and a nested object is left out:
 * a cell has room for one line, and its JSON would be noise rather than a value.
 */
function frontmatterText(raw: unknown): string {
	if (raw === null || raw === undefined) {
		return '';
	}
	if (Array.isArray(raw)) {
		return raw
			.map((item) => frontmatterText(item))
			.filter((text) => text !== '')
			.join(', ');
	}
	if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
		return String(raw);
	}
	return '';
}

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
