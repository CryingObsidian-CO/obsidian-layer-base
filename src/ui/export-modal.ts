import {
	AbstractInputSuggest,
	Modal,
	normalizePath,
	Setting,
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
	/**
	 * The folder path as typed, which is both what the input shows and what a
	 * submit uses.
	 *
	 * Kept as text rather than as a folder: holding the last folder that existed at
	 * a typed path meant the input could show one place while the export went to
	 * another, silently.
	 */
	private folderPath: string;
	private name: string;
	private errorEl: HTMLElement | null = null;

	constructor(private readonly config: ExportModalOptions) {
		super(config.app);
		const parent = config.boardFile.parent;
		this.folderPath = parent && !parent.isRoot() ? parent.path : '';
		this.name = config.boardFile.basename;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('layer-export-modal');

		new Setting(contentEl)
			.setName(t().exportTitle)
			.setHeading()
			.settingEl.addClass('layer-export-title');

		const folderRow = contentEl.createDiv({ cls: 'layer-field-grid' });
		folderRow.createDiv({ cls: 'layer-field-label', text: t().exportFolder });
		const folderInput = folderRow.createEl('input', {
			cls: 'layer-field-number-format',
			type: 'text',
		});
		folderInput.placeholder = t().exportFolderPlaceholder;
		folderInput.value = this.folderPath;
		const folders = this.app.vault
			.getAllFolders()
			.slice()
			.sort((a, b) => a.path.localeCompare(b.path));
		new FolderSuggest(this.app, folderInput, folders);
		folderInput.addEventListener('input', () => {
			// The typed path is the answer; whether a folder exists at it is asked when
			// the reader is finished typing, so a half-written path does not flash an
			// error under every keystroke.
			this.folderPath = normalizePath(folderInput.value.trim());
			this.paint();
		});
		folderInput.addEventListener('blur', () => this.paint(true));

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

	/**
	 * Shows what is wrong, so the reader can fix it before confirming.
	 *
	 * The folder is only reported once the reader is done with that field — on
	 * blur, or on an attempt to confirm — because every half-typed path is a folder
	 * that does not exist yet.
	 */
	private paint(reportFolder = false): void {
		const error = this.errorEl;
		if (!error) {
			return;
		}
		error.empty();
		error.removeClass('is-visible');
		const reason = reportFolder
			? this.nameProblem() || this.folderProblem()
			: this.nameProblem();
		if (reason !== '') {
			error.addClass('is-visible');
			error.setText(reason);
		}
	}

	/** What is wrong with the name, or an empty string. */
	private nameProblem(): string {
		if (this.name.trim() === '') {
			return t().exportNameEmpty;
		}
		if (/[\\/:*?"<>|]/.test(this.name)) {
			return t().exportNameInvalid;
		}
		return '';
	}

	private submit(): void {
		const folder = this.folderInVault();
		if (folder === null || this.nameProblem() !== '') {
			this.paint(true);
			return;
		}
		this.config.onSubmit({ folder, name: this.name.trim() });
		this.close();
	}

	/** The folder the typed path names, or null when the vault has none there. */
	private folderInVault(): TFolder | null {
		if (this.folderPath === '') {
			return this.app.vault.getRoot();
		}
		return this.app.vault.getFolderByPath(this.folderPath);
	}

	/** What is wrong with the typed folder path, or an empty string. */
	private folderProblem(): string {
		return this.folderInVault() === null ? t().exportFolderInvalid : '';
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
