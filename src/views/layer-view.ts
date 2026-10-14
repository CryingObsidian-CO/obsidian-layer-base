import {Notice, TextFileView, type TFile, type WorkspaceLeaf} from 'obsidian';
import {LAYER_EXTENSION, VIEW_TYPE_LAYER} from '../constants';
import {t} from '../i18n';
import {parseLayerDoc, serializeLayerDoc} from '../io/schema';
import type LayerBasePlugin from '../main';
import type {LayerDoc} from '../types';

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
		this.containerEl.empty();
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
		// M0 only proves the file round-trips; the real grid and board views
		// arrive in M2 and M3.
		const s = t();
		this.containerEl.empty();
		const preview = this.containerEl.createDiv({cls: 'layer-base-preview'});
		preview.createEl('h2', {text: this.doc?.name ?? s.placeholderBoard});
		const summary = this.doc
			? s.summaryLine(
				this.doc.fields.length,
				this.doc.records.length,
				this.doc.views.length,
			)
			: s.emptyFile;
		preview.createEl('p', {text: summary});
		preview.createEl('pre', {text: this.getViewData()});
	}
}

export function createLayerView(
	leaf: WorkspaceLeaf,
	plugin: LayerBasePlugin,
): LayerView {
	return new LayerView(leaf, plugin);
}
