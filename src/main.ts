import { Notice, Plugin, TFile, TFolder } from 'obsidian';
import {
	COMMAND_CREATE_FILE,
	LAYER_EXTENSION,
	VIEW_TYPE_LAYER,
} from './constants';
import { seedLabels, t } from './i18n';
import { createEmptyDoc, serializeLayerDoc } from './io/schema';
import {
	DEFAULT_SETTINGS,
	LayerBaseSettingTab,
	type LayerBaseSettings,
} from './settings';
import { createLayerView } from './views/layer-view';

/** Upper bound on retries when a name collision keeps coming back. */
const MAX_CREATE_ATTEMPTS = 50;

export default class LayerBasePlugin extends Plugin {
	settings!: LayerBaseSettings;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE_LAYER, (leaf) => createLayerView(leaf, this));
		// Routes `.layer` files to the view above. Without this line Obsidian
		// would open them as plain text.
		this.registerExtensions([LAYER_EXTENSION], VIEW_TYPE_LAYER);

		this.addRibbonIcon('layout-grid', t().ribbonNewBoard, () => {
			void this.createLayerFile();
		});

		this.addCommand({
			id: COMMAND_CREATE_FILE,
			name: t().commandCreateFile,
			callback: () => {
				void this.createLayerFile();
			},
		});

		this.addSettingTab(new LayerBaseSettingTab(this.app, this));
	}

	onunload(): void {
		// Views, listeners and the setting tab registered above are removed by
		// Obsidian through the register* helpers.
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<LayerBaseSettings>,
		);
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Creates a `.layer` file in the configured folder and opens it. */
	async createLayerFile(): Promise<void> {
		const folderPath = this.settings.defaultFolder.trim();
		const folder = folderPath ? this.resolveFolder(folderPath) : null;
		if (folderPath && !folder) {
			new Notice(t().noticeFolderMissing(folderPath));
			console.warn(
				`[obsidian-layer-base] Configured folder does not exist: ${folderPath}`,
			);
			return;
		}

		const base = this.settings.defaultFileName.trim() || t().placeholderBoard;

		try {
			const file = await this.createWithFreeName(folder, base);
			const leaf = this.app.workspace.getLeaf('tab');
			await leaf.openFile(file);
			new Notice(t().noticeCreated(file.basename));
		} catch (error) {
			new Notice(t().noticeCreateFailed);
			console.error('[obsidian-layer-base] Failed to create board:', error);
		}
	}

	/**
	 * Creates `<folder>/<base>.layer`, appending a counter until the path is free.
	 *
	 * The pre-check only inspects the target folder, because that is the only
	 * scope where a collision would make `vault.create` fail. The retry loop is
	 * what actually guarantees correctness: between the check and the write,
	 * another window can create the same name, so a failed create must be
	 * treated as "try the next name" rather than as an error.
	 */
	private async createWithFreeName(
		folder: TFolder | null,
		base: string,
	): Promise<TFile> {
		const taken = this.takenNamesIn(folder);
		let name = base;
		for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt++) {
			if (attempt > 1) {
				name = `${base} ${attempt}`;
			}
			// Skip names already known to be taken before attempting the write.
			if (taken.has(name) && attempt > 1) {
				continue;
			}

			const path = folder
				? `${folder.path}/${name}.${LAYER_EXTENSION}`
				: `${name}.${LAYER_EXTENSION}`;

			try {
				await this.app.vault.create(
					path,
					serializeLayerDoc(createEmptyDoc(name, seedLabels())),
				);
			} catch (error) {
				// Lost a race with another writer, or the folder disappeared.
				taken.add(name);
				console.warn(
					`[obsidian-layer-base] "${path}" is taken, trying the next name:`,
					error,
				);
				continue;
			}

			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				return file;
			}
			throw new Error(`Created file is not retrievable: ${path}`);
		}
		throw new Error(
			`Could not find a free name after ${MAX_CREATE_ATTEMPTS} attempts`,
		);
	}

	/** Names already used by `.layer` files directly inside one folder. */
	private takenNamesIn(folder: TFolder | null): Set<string> {
		const taken = new Set<string>();
		if (folder) {
			for (const child of folder.children) {
				if (child instanceof TFile && child.extension === LAYER_EXTENSION) {
					taken.add(child.basename);
				}
			}
			return taken;
		}
		// The vault root is also a folder, so it takes the same path.
		const root = this.app.vault.getRoot();
		for (const child of root.children) {
			if (child instanceof TFile && child.extension === LAYER_EXTENSION) {
				taken.add(child.basename);
			}
		}
		return taken;
	}

	/** Resolves a configured folder path, returning null when it is absent. */
	private resolveFolder(path: string): TFolder | null {
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFolder ? file : null;
	}
}