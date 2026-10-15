import { Modal, Setting, type App } from 'obsidian';
import { t } from '../i18n';
import { FIELD_TYPES, usesOptions } from '../model/fields';
import type { Field, FieldType, SelectOption } from '../types';
import { generateId } from '../utils/id';

/**
 * Add or edit one field: its name, its type, and the options of an option-based
 * type.
 *
 * The modal edits a *draft* and only calls `onSubmit` when the user saves, so
 * cancelling leaves the document untouched. Type changes are applied by the
 * caller through `changeFieldType`, where value conversion and its data-loss
 * accounting live.
 */

export interface FieldEditorResult {
	name: string;
	type: FieldType;
	options: SelectOption[];
	/** True when an existing field's type was changed. */
	typeChanged: boolean;
}

export interface FieldEditorOptions {
	app: App;
	/** Field being edited, or null to create a new one. */
	field: Field | null;
	/** Applies the edit. */
	onSubmit: (result: FieldEditorResult) => void;
}

export class FieldEditorModal extends Modal {
	private name: string;
	private type: FieldType;
	private draftOptions: SelectOption[];
	private readonly originalType: FieldType | null;

	private optionsEl: HTMLElement | null = null;
	private errorEl: HTMLElement | null = null;

	constructor(private readonly config: FieldEditorOptions) {
		super(config.app);
		this.name = config.field?.name ?? '';
		this.type = config.field?.type ?? 'text';
		this.draftOptions = (config.field?.options ?? []).map((o) => ({ ...o }));
		this.originalType = config.field?.type ?? null;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('layer-field-editor');
		contentEl.createEl('h2', {
			text: this.config.field === null ? t().fieldNewTitle : t().fieldEditTitle,
		});

		new Setting(contentEl).setName(t().fieldNameLabel).addText((text) =>
			text
				.setPlaceholder(t().fieldNamePlaceholder)
				.setValue(this.name)
				.onChange((value) => {
					this.name = value;
				}),
		);

		new Setting(contentEl).setName(t().fieldTypeLabel).addDropdown((dropdown) => {
			for (const type of FIELD_TYPES) {
				dropdown.addOption(type, typeLabel(type));
			}
			dropdown.setValue(this.type);
			dropdown.onChange((value) => {
				this.type = value as FieldType;
				this.renderOptions();
			});
		});

		this.optionsEl = contentEl.createDiv({ cls: 'layer-field-options' });
		this.renderOptions();

		this.errorEl = contentEl.createDiv({ cls: 'layer-field-error' });

		const actions = contentEl.createDiv({ cls: 'layer-field-actions' });
		const cancel = actions.createEl('button', { text: t().cancel });
		cancel.addEventListener('click', () => this.close());
		const save = actions.createEl('button', { cls: 'mod-cta', text: t().save });
		save.addEventListener('click', () => this.submit());
	}

	/** Options only apply to a type that stores them. */
	private renderOptions(): void {
		const host = this.optionsEl;
		if (!host) {
			return;
		}
		host.empty();

		if (!usesOptions(this.type)) {
			return;
		}

		host.createEl('h3', { text: t().fieldOptionsLabel });

		for (const option of this.draftOptions) {
			const row = host.createDiv({ cls: 'layer-field-option-row' });

			const input = row.createEl('input', {
				cls: 'layer-field-option-input',
				type: 'text',
			});
			input.value = option.name;
			input.addEventListener('input', () => {
				option.name = input.value;
			});

			const color = row.createEl('input', {
				cls: 'layer-field-option-color',
				type: 'color',
			});
			color.value = toHexColor(option.color);
			color.addEventListener('input', () => {
				option.color = color.value;
			});

			const remove = row.createEl('button', {
				cls: 'layer-field-option-remove',
				text: '×',
			});
			remove.setAttribute('aria-label', t().fieldRemoveOption);
			remove.addEventListener('click', () => {
				this.draftOptions = this.draftOptions.filter(
					(o) => o.id !== option.id,
				);
				this.renderOptions();
			});
		}

		const add = host.createEl('button', {
			cls: 'layer-field-add-option',
			text: t().fieldAddOption,
		});
		add.addEventListener('click', () => {
			this.draftOptions.push({ id: generateId('o'), name: '', color: 'default' });
			this.renderOptions();
		});
	}

	private submit(): void {
		const name = this.name.trim();
		if (!name) {
			this.errorEl?.setText(t().fieldNameRequired);
			return;
		}

		this.config.onSubmit({
			name,
			type: this.type,
			// An unnamed option would render as a blank choice, so it is dropped
			// rather than stored.
			options: this.draftOptions.filter((o) => o.name.trim() !== ''),
			typeChanged: this.originalType !== null && this.originalType !== this.type,
		});
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/** The localised name of a field type. */
function typeLabel(type: FieldType): string {
	const s = t();
	switch (type) {
		case 'text':
			return s.typeText;
		case 'select':
			return s.typeSelect;
	}
}

/**
 * Option colours are stored as theme colour names, but a colour input only
 * accepts hex. A non-hex value keeps a neutral fallback so the input always has
 * something valid to show.
 */
function toHexColor(color: string): string {
	return /^#[0-9a-f]{6}$/i.test(color) ? color : '#888888';
}
