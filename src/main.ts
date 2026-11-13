/*
 * Layer Base — multi-dimensional boards for Obsidian.
 * Copyright (C) 2026 CryingObsidian-CO
 *
 * This program is free software: you can redistribute it and/or modify it under the
 * terms of the GNU General Public License as published by the Free Software Foundation,
 * either version 3 of the License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A
 * PARTICULAR PURPOSE. See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along with this
 * program. If not, see <https://www.gnu.org/licenses/>.
 */

import { normalizePath, Notice, Plugin, TFolder } from 'obsidian';
import {
	COMMAND_CREATE_FILE,
	COMMAND_REDO,
	COMMAND_UNDO,
	LAYER_EXTENSION,
	VIEW_TYPE_LAYER,
} from './constants';
import { seedLabels, t } from './i18n';
import { LayerStore } from './io/layer-store';
import {
	DEFAULT_SETTINGS,
	LayerBaseSettingTab,
	LEGACY_DEFAULT_FILE_NAME,
	type LayerBaseSettings,
} from './settings';
import { createLayerView, LayerView } from './views/layer-view';
import { TableIndex } from './io/table-index';

export default class LayerBasePlugin extends Plugin {
	settings!: LayerBaseSettings;
	store!: LayerStore;
	/** Other `.layer` files a relation may read. */
	tables!: TableIndex;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.store = new LayerStore(this.app);
		this.tables = new TableIndex(this.app);
		this.tables.register(this);

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

		/*
		 * `ItemView.scope` is null unless something creates one, and a binding made against
		 * it never fires; a command is a hook Obsidian can bind a key to.
		 */
		this.addCommand({
			id: COMMAND_UNDO,
			name: t().undoEdit,
			checkCallback: (checking) => this.runOnActiveLayerView(checking, (view) => {
				view.runUndo();
			}),
		});
		this.addCommand({
			id: COMMAND_REDO,
			name: t().redoEdit,
			checkCallback: (checking) => this.runOnActiveLayerView(checking, (view) => {
				view.runRedo();
			}),
		});

		/* `action-primary` puts this next to "new note"; a plain `action` would land in
		 * the duplicate/move group further down. */
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				const folder = file instanceof TFolder ? file : file.parent;
				menu.addItem((item) =>
					item
						.setTitle(t().menuCreateBoard)
						.setIcon('layout-grid')
						.setSection('action-primary')
						.onClick(() => {
							void this.createLayerFile(folder);
						}),
				);
			}),
		);

		this.addSettingTab(new LayerBaseSettingTab(this.app, this));
	}

	onunload(): void {}

	/** False keeps the command out of the palette when no layer view is in front. */
	runOnActiveLayerView(
		checking: boolean,
		run: (view: LayerView) => void,
	): boolean {
		const view = this.app.workspace.getActiveViewOfType(LayerView);
		if (!view) {
			return false;
		}
		if (!checking) {
			run(view);
		}
		return true;
	}


	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<LayerBaseSettings>,
		);
		/* Saved settings can still hold the old English default, which would pin every new
		 * file to English; only that exact value is cleared. */
		if (this.settings.defaultFileName === LEGACY_DEFAULT_FILE_NAME) {
			this.settings.defaultFileName = '';
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** A folder from the file explorer's menu wins over the configured default. */
	async createLayerFile(targetFolder?: TFolder | null): Promise<void> {
		let folder: TFolder | null = targetFolder ?? null;
		if (!folder) {
			const folderPath = this.settings.defaultFolder.trim();
			folder = folderPath ? this.resolveFolder(folderPath) : null;
			if (folderPath && !folder) {
				new Notice(t().noticeFolderMissing(folderPath));
				console.warn(
					`[layer-base] Configured folder does not exist: ${folderPath}`,
				);
				return;
			}
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
			console.error('[layer-base] Failed to create board:', error);
		}
	}

	private resolveFolder(path: string): TFolder | null {
		// A hand-typed setting is normalised before the lookup.
		const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
		return file instanceof TFolder ? file : null;
	}
}
