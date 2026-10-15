import { App, PluginSettingTab, type SettingDefinitionItem } from 'obsidian';
import { t } from './i18n';
import LayerBasePlugin from './main';

export interface LayerBaseSettings {
	/** Folder for newly created boards. Empty means the vault root. */
	defaultFolder: string;
	/** Base name for newly created boards; a numeric suffix is added if taken. */
	defaultFileName: string;
}

export const DEFAULT_SETTINGS: LayerBaseSettings = {
	defaultFolder: '',
	defaultFileName: 'Untitled board',
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
		const typed = value as LayerBaseSettings[SettingsKey];
		this.plugin.settings[key as SettingsKey] = typed;
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
		];
	}
}
