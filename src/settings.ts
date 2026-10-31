import { App, PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { t } from './i18n';
import LayerBasePlugin from './main';
import type { NoteLabelStyle } from './types';

export interface LayerBaseSettings {
	/** Folder for newly created boards. Empty means the vault root. */
	defaultFolder: string;
	/** Base name for newly created boards; a numeric suffix is added if taken. */
	defaultFileName: string;
	/** What a `note` cell shows: the file's own name, or the path it lives at. */
	noteLabel: NoteLabelStyle;
}

export const DEFAULT_SETTINGS: LayerBaseSettings = {
	defaultFolder: '',
	defaultFileName: 'Untitled board',
	noteLabel: 'name',
};

/** Keys of the settings object, used as control keys in the declarative API. */
type SettingsKey = keyof LayerBaseSettings;

export class LayerBaseSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: LayerBasePlugin,
	) {
		super(app, plugin);
	}

	getControlValue(key: string): unknown {
		const value = this.plugin.settings[key as SettingsKey];
		return typeof value === 'string' ? value.trim() : value;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		/*
		 * Written through an index rather than by the key's own type: the settings hold
		 * values of different types, and a union of keys narrows to what every one of
		 * them accepts — which is only the narrowest, so a plain string would not be
		 * assignable to the dropdown's two spellings.
		 */
		const settings = this.plugin.settings as unknown as Record<string, unknown>;
		settings[key] = value;
		await this.plugin.saveSettings();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		const s = t();
		return [
			{
				name: s.settingFolderName,
				desc: s.settingFolderDesc,
				control: {
					type: 'folder',
					key: 'defaultFolder',
					includeRoot: true,
				},
			},
			{
				name: s.settingFileNameName,
				desc: s.settingFileNameDesc,
				control: {
					type: 'text',
					key: 'defaultFileName',
					placeholder: s.placeholderBoard,
				},
			},
			{
				name: s.settingNoteLabelName,
				desc: s.settingNoteLabelDesc,
				control: {
					type: 'dropdown',
					key: 'noteLabel',
					options: {
						name: s.noteLabelName,
						path: s.noteLabelPath,
					},
				},
			},
		];
	}
}
