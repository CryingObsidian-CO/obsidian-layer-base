import { Notice, Plugin, TFolder } from 'obsidian';
import {
	COMMAND_CREATE_FILE,
	LAYER_EXTENSION,
	VIEW_TYPE_LAYER,
} from './constants';
import { seedLabels, t } from './i18n';
import { LayerStore } from './io/layer-store';
import {
	DEFAULT_SETTINGS,
	LayerBaseSettingTab,
	type LayerBaseSettings,
} from './settings';
import { createLayerView } from './views/layer-view';

export default class LayerBasePlugin extends Plugin {
	settings!: LayerBaseSettings;
	store!: LayerStore;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.store = new LayerStore(this.app);

		this.registerView(VIEW_TYPE_LAYER, (leaf) => createLayerView(leaf, this));
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

	onunload(): void {}

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

		try {
			const file = await this.store.createBoard(
				folder,
				this.settings.defaultFileName,
				seedLabels(),
			);
			const leaf = this.app.workspace.getLeaf('tab');
			await leaf.openFile(file);
			new Notice(t().noticeCreated(file.basename));
		} catch (error) {
			new Notice(t().noticeCreateFailed);
			console.error('[obsidian-layer-base] Failed to create board:', error);
		}
	}

	/** Resolves a configured folder path, returning null when it is absent. */
	private resolveFolder(path: string): TFolder | null {
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFolder ? file : null;
	}
}
