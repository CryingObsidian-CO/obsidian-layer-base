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
	// Empty folder means the vault root, which is a real choice, not a gap.
	defaultFolder: '',
	// Persisted defaults are fixed rather than derived from the app language:
	// this value is written to data.json once, and a stable stored preference is
	// easier to reason about than one that shifts with the UI locale.
	defaultFileName: 'Untitled board',
};

/** Keys of the settings object, used as control keys in the declarative API. */
type SettingsKey = keyof LayerBaseSettings;

/**
 * Settings tab built with the declarative API introduced in Obsidian 1.13.0.
 *
 * Implementing `getSettingDefinitions` is what puts these entries into the app's
 * settings search; the older `display()` builder is invisible to it.
 */
export class LayerBaseSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: LayerBasePlugin,
	) {
		super(app, plugin);
	}

	/**
	 * Trims stored values on the way out.
	 *
	 * The folder and file name are both typed by hand often enough that trailing
	 * whitespace would otherwise leak into file paths such as `"Board .layer"`.
	 */
	getControlValue(key: string): unknown {
		const value = this.plugin.settings[key as SettingsKey];
		return typeof value === 'string' ? value.trim() : value;
	}

	/** Writes back into `plugin.settings` and persists the file. */
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
					// The vault root is a valid target, so offer it explicitly
					// rather than leaving users unable to select it.
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