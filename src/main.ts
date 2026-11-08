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
	/** The other `.layer` files a relation may read, cached and kept current. */
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
		 * Undo and redo are commands rather than keys bound to the view's own scope.
		 * `ItemView.scope` is null unless something creates one, and a scope-less
		 * binding never fires — which is why pressing the key did nothing. A command
		 * also gives them a place in the command palette and lets Obsidian own the key
		 * handling, so a shortcut the editor wants does not swallow them silently.
		 *
		 * `checkCallback` decides availability per active view, so the command is only
		 * offered while a table or board is in front.
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

		/*
		 * The file explorer already offers "new note" where the reader is pointing, so a
		 * new board belongs in the same place. The folder right-clicked wins over the
		 * configured one: that is the folder the reader meant.
		 *
		 * `setSection('action-primary')` is what puts it next to "new note" rather than at
		 * the bottom of the menu. The file explorer orders its sections as
		 * title, open, action-primary, action, info, view, system, "", danger — so a plain
		 * 'action' lands in the duplicate/move group below.
		 */
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

	/**
	 * Runs an action on the layer view in front, answering whether there is one.
	 *
	 * Returning false from `checkCallback` keeps the command out of the palette when
	 * no layer view is active, rather than offering it and doing nothing.
	 */
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
		/*
		 * The base name used to be the English literal. It is now the reader's own
		 * language, but saved settings keep a copy of the old default, which would
		 * pin every new file to English. Only that exact value is cleared: a name
		 * someone typed is kept as it is.
		 */
		if (this.settings.defaultFileName === LEGACY_DEFAULT_FILE_NAME) {
			this.settings.defaultFileName = '';
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/**
	 * Creates a `.layer` file and opens it.
	 *
	 * A folder passed in comes from the file explorer's menu, and it wins over the
	 * configured default: the reader pointed at the place they want it.
	 */
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

	/** Resolves a configured folder path, returning null when it is absent. */
	private resolveFolder(path: string): TFolder | null {
		// The setting is typed or picked by hand, so it is normalised before asking.
		const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
		return file instanceof TFolder ? file : null;
	}
}
