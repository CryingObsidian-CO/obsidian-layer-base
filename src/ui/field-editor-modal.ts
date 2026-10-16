import { setIcon, type App } from 'obsidian';
import { t } from '../i18n';
import { specFor, usesOptions } from '../model/fields';
import type { Field, FieldType, SelectOption } from '../types';
import { generateId } from '../utils/id';
import { AnchoredPopover, type Anchor } from './anchored-popover';
import { FieldTypeDropdown } from './field-type-picker';

export interface FieldEditorResult {
	name: string;
	type: FieldType;
	options: SelectOption[];
	typeChanged: boolean;
}

export interface FieldEditorOptions {
	app: App;
	field: Field | null;
	/** What the panel opens next to; null centres it. */
	anchor?: Anchor | null;
	onSubmit: (result: FieldEditorResult) => void;
}

/** Width of the panel, applied inline — see the note on `AnchoredPopover.setWidth`. */
const FIELD_EDITOR_WIDTH = '17rem';

export class FieldEditorModal extends AnchoredPopover {
	private name: string;
	private type: FieldType;
	private draftOptions: SelectOption[];
	private readonly originalType: FieldType | null;

	private optionsEl: HTMLElement | null = null;
	private errorEl: HTMLElement | null = null;
	private typeButton: HTMLButtonElement | null = null;
	private typeDropdown: FieldTypeDropdown | null = null;

	constructor(private readonly config: FieldEditorOptions) {
		super(config.app, config.anchor ?? null, FIELD_EDITOR_WIDTH);
		this.name = config.field?.name ?? '';
		this.type = config.field?.type ?? 'text';
		this.draftOptions = (config.field?.options ?? []).map((o) => ({ ...o }));
		this.originalType = config.field?.type ?? null;
	}

	onOpen(): void {
		super.onOpen();
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('layer-field-editor');

		const grid = contentEl.createDiv({ cls: 'layer-field-grid' });
		grid.createDiv({ cls: 'layer-field-label', text: t().fieldNameLabel });
		const nameInput = grid.createEl('input', {
			cls: 'layer-field-name',
			type: 'text',
		});
		nameInput.placeholder = t().fieldNamePlaceholder;
		nameInput.value = this.name;
		nameInput.addEventListener('input', () => {
			this.name = nameInput.value;
		});

		grid.createDiv({ cls: 'layer-field-label', text: t().fieldTypeLabel });
		this.typeButton = grid.createEl('button', {
			cls: 'layer-field-type',
		});
		this.typeButton.type = 'button';
		// Kept from taking focus: a click would otherwise claim it after the
		// dropdown has put the caret in its search box.
		this.typeButton.addEventListener('mousedown', (event) => {
			event.preventDefault();
		});
		this.typeButton.addEventListener('click', (event) => {
			event.preventDefault();
			this.openTypePicker();
		});
		this.paintTypeButton();

		this.optionsEl = contentEl.createDiv({ cls: 'layer-field-options' });
		this.renderOptions();

		this.errorEl = contentEl.createDiv({ cls: 'layer-field-error' });

		const actions = contentEl.createDiv({ cls: 'layer-field-actions' });
		const cancel = actions.createEl('button', { text: t().cancel });
		cancel.addEventListener('click', () => this.close());
		const save = actions.createEl('button', { cls: 'mod-cta', text: t().save });
		save.addEventListener('click', () => this.submit());

		window.setTimeout(() => {
			// Laid out first, so the panel's height is known before it is placed.
			this.position();
			nameInput.focus();
		}, 0);
	}

	private openTypePicker(): void {
		const button = this.typeButton;
		if (!button) {
			return;
		}
		// One at a time: a second click on the button should not stack a list.
		this.typeDropdown?.close();
		this.typeDropdown = new FieldTypeDropdown(button, this.type, (type) => {
			this.type = type;
			this.paintTypeButton();
			this.renderOptions();
		});
	}

	/** Shows the chosen type on the button that opens the picker. */
	private paintTypeButton(): void {
		const button = this.typeButton;
		if (!button) {
			return;
		}
		button.empty();
		setIcon(
			button.createSpan({ cls: 'layer-field-type-icon' }),
			specFor(this.type).icon,
		);
		button.createSpan({
			cls: 'layer-field-type-name',
			text: this.type === 'text' ? t().typeText : t().typeSelect,
		});
		button.createSpan({ cls: 'layer-field-type-chevron' });
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
			options: this.draftOptions.filter((o) => o.name.trim() !== ''),
			typeChanged: this.originalType !== null && this.originalType !== this.type,
		});
		this.close();
	}

	/** Lets the open type list take the first Escape. */
	protected override handlesEscape(): boolean {
		return this.typeDropdown?.isOpen() ?? false;
	}

	onClose(): void {
		super.onClose();
		// Torn down before the container goes: the list is parented to it.
		this.typeDropdown?.close();
		this.typeDropdown = null;
		this.contentEl.empty();
	}
}

function toHexColor(color: string): string {
	return /^#[0-9a-f]{6}$/i.test(color) ? color : '#888888';
}
