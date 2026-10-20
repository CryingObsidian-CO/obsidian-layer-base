import {
	AbstractInputSuggest,
	Modal,
	normalizePath,
	TFolder,
	type App,
} from 'obsidian';
import { t } from '../i18n';

export interface ExportModalOptions {
	app: App;
	/** The board the export is taken from, which decides the default place. */
	boardFile: { path: string; basename: string; parent: TFolder | null };
	onSubmit: (result: { folder: TFolder; name: string }) => void;
}

/** Offers the vault's folders while a path is typed. */
class FolderSuggest extends AbstractInputSuggest<TFolder> {
	constructor(
		app: App,
		private readonly inputEl: HTMLInputElement,
		private readonly folders: readonly TFolder[],
	) {
		super(app, inputEl);
	}

	protected getSuggestions(query: string): TFolder[] {
		const needle = query.trim().toLowerCase();
		if (needle === '') {
			return this.folders.slice(0, 50);
		}
		return this.folders
			.filter((folder) => folder.path.toLowerCase().includes(needle))
			.slice(0, 50);
	}

	renderSuggestion(folder: TFolder, el: HTMLElement): void {
		// The root has an empty path, which would otherwise render as a blank row.
		el.setText(folder.isRoot() ? '/' : folder.path);
	}

	selectSuggestion(folder: TFolder): void {
		this.inputEl.value = folder.isRoot() ? '' : folder.path;
		this.inputEl.dispatchEvent(new Event('input'));
		this.close();
	}
}

/**
 * Where an export goes, asked before it is written.
 *
 * A file appearing in the vault is worth confirming, so folder and name are shown
 * rather than assumed. Both default to the board's own, so confirming is one press.
 */
export class ExportModal extends Modal {
	private folder: TFolder;
	private name: string;
	private errorEl: HTMLElement | null = null;

	constructor(private readonly config: ExportModalOptions) {
		super(config.app);
		this.folder = config.boardFile.parent ?? config.app.vault.getRoot();
		this.name = config.boardFile.basename;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('layer-export-modal');

		contentEl.createEl('h2', { cls: 'layer-export-title', text: t().exportTitle });

		const folderRow = contentEl.createDiv({ cls: 'layer-field-grid' });
		folderRow.createDiv({ cls: 'layer-field-label', text: t().exportFolder });
		const folderInput = folderRow.createEl('input', {
			cls: 'layer-field-number-format',
			type: 'text',
		});
		folderInput.placeholder = t().exportFolderPlaceholder;
		folderInput.value = this.folder.isRoot() ? '' : this.folder.path;
		const folders = this.app.vault
			.getAllFolders()
			.slice()
			.sort((a, b) => a.path.localeCompare(b.path));
		new FolderSuggest(this.app, folderInput, folders);
		folderInput.addEventListener('input', () => {
			const path = normalizePath(folderInput.value.trim());
			const found =
				path === '' ? this.app.vault.getRoot() : this.app.vault.getFolderByPath(path);
			// An unknown path is kept as it was: it is reported on submit, which is
			// where the reader can do something about it.
			if (found) {
				this.folder = found;
			}
			this.paint();
		});

		const nameRow = contentEl.createDiv({ cls: 'layer-field-grid' });
		nameRow.createDiv({ cls: 'layer-field-label', text: t().exportFileName });
		const nameInput = nameRow.createEl('input', {
			cls: 'layer-field-number-format',
			type: 'text',
		});
		nameInput.value = this.name;
		nameInput.addEventListener('input', () => {
			this.name = nameInput.value;
			this.paint();
		});

		this.errorEl = contentEl.createDiv({ cls: 'layer-export-error' });

		const actions = contentEl.createDiv({ cls: 'layer-export-actions' });
		const cancel = actions.createEl('button', { text: t().cancel });
		cancel.addEventListener('click', () => this.close());
		const confirm = actions.createEl('button', {
			cls: 'mod-cta',
			text: t().exportConfirm,
		});
		confirm.addEventListener('click', () => this.submit());

		this.paint();
		window.setTimeout(() => nameInput.select(), 0);
	}

	/** Shows what will be written, and refuses a name that cannot be used. */
	private paint(): void {
		const error = this.errorEl;
		if (!error) {
			return;
		}
		error.empty();
		error.removeClass('is-visible');
		const reason = this.problemWith();
		if (reason !== '') {
			error.addClass('is-visible');
			error.setText(reason);
		}
	}

	private problemWith(): string {
		if (this.name.trim() === '') {
			return t().exportNameEmpty;
		}
		if (/[\\/:*?"<>|]/.test(this.name)) {
			return t().exportNameInvalid;
		}
		return '';
	}

	private submit(): void {
		if (this.problemWith() !== '') {
			this.paint();
			return;
		}
		this.config.onSubmit({ folder: this.folder, name: this.name.trim() });
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** The full path a file will be written to, for reporting back. */
export function exportPath(folder: TFolder, fileName: string): string {
	const clean = fileName.endsWith('.csv') ? fileName : `${fileName}.csv`;
	return folder.isRoot() ? clean : `${folder.path}/${clean}`;
}
