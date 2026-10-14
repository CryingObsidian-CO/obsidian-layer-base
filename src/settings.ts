import { App, PluginSettingTab, Setting } from 'obsidian';
import { t } from './i18n';
import LayerBasePlugin from './main';

export interface LayerBaseSettings {
	/** Folder for newly created boards. Empty means the vault root. */
	defaultFolder: string;
	/** Base name for newly created boards; a numeric suffix is added if taken. */
	defaultFileName: string;
}

export const DEFAULT_SETTINGS: LayerBaseSettings = {
	// Empty means "fall back to the localised placeholder" at use time, so the
	// default name follows the app language instead of freezing one locale here.
	defaultFolder: '',
	defaultFileName: '',
};

export class LayerBaseSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: LayerBasePlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		const s = t();

		new Setting(containerEl)
			.setName(s.settingFolderName)
			.setDesc(s.settingFolderDesc)
			.addText((text) =>
				text
					.setPlaceholder('Projects')
					.setValue(this.plugin.settings.defaultFolder)
					.onChange(async (value) => {
						this.plugin.settings.defaultFolder = value.trim();
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName(s.settingFileNameName)
			.setDesc(s.settingFileNameDesc)
			.addText((text) =>
				text
					.setPlaceholder(s.placeholderBoard)
					.setValue(this.plugin.settings.defaultFileName)
					.onChange(async (value) => {
						this.plugin.settings.defaultFileName = value.trim();
						await this.plugin.saveSettings();
					}),
			);
	}
}