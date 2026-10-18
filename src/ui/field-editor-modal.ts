import { setIcon, type App } from 'obsidian';
import { t } from '../i18n';
import { specFor, usesOptions } from '../model/fields';
import {
	MAX_DECIMALS,
	normaliseDecimals,
	normaliseFormat,
	parseOptionalNumber,
} from '../model/number';
import { optionColorHex } from '../model/select-options';
import type { TableIndex } from '../io/table-index';
import type {
	Field,
	FieldType,
	NumberFormat,
	SelectOption,
} from '../types';
import { generateId } from '../utils/id';
import { AnchoredPopover, type Anchor } from './anchored-popover';
import { FieldTypeDropdown } from './field-type-picker';
import { renderOptionPill } from './option-pill';

export interface NumberSettings {
	format: NumberFormat;
	decimals: number | null;
	min: number | null;
	max: number | null;
}

export interface RelationSettings {
	/** The `.layer` file, or `''` for this table. */
	path: string;
	/** The column of that table whose values the cell shows. */
	fieldId: string;
}

export interface BackSettings extends RelationSettings {
	/** The column a pointing row is named by; `''` for its row number. */
	titleFieldId: string;
}

export interface FieldEditorResult {
	name: string;
	type: FieldType;
	options: SelectOption[];
	required: boolean;
	number: NumberSettings;
	relation: RelationSettings;
	/** The reverse relation's source, when the type is `relationBack`. */
	back: BackSettings;
	typeChanged: boolean;
}

export interface FieldEditorOptions {
	app: App;
	field: Field | null;
	/** What the panel opens next to; null centres it. */
	anchor?: Anchor | null;
	/** The tables a relation may point at; also loads their columns. */
	tables: TableIndex;
	/** This document's own columns, so a self-reference needs no read. */
	selfFields: readonly Field[];
	/** This document's own vault path, kept out of the list to avoid a duplicate. */
	selfPath: string;
	onSubmit: (result: FieldEditorResult) => void;
}

/** How wide the panel is; `AnchoredPopover` applies it inline, since a modal's own width can only be moved with `!important`. */
const FIELD_EDITOR_WIDTH = '17rem';

/*
 * The name of each type on the button that opens the picker, read lazily so a
 * language change is picked up rather than frozen at module load.
 */
const FIELD_TYPE_LABELS: Record<FieldType, () => string> = {
	text: () => t().typeText,
	longtext: () => t().typeLongText,
	number: () => t().typeNumber,
	date: () => t().typeDate,
	datetime: () => t().typeDateTime,
	relation: () => t().typeRelation,
	relationBack: () => t().typeRelationBack,
	select: () => t().typeSelect,
	multiSelect: () => t().typeMultiSelect,
	checkbox: () => t().typeCheckbox,
};

/** Whether a column's text form can stand in for a row's name. */
function canNameARow(field: Field): boolean {
	return (
		field.type !== 'relation' &&
		field.type !== 'relationBack' &&
		field.type !== 'checkbox'
	);
}

export class FieldEditorModal extends AnchoredPopover {
	private name: string;
	private type: FieldType;
	private required: boolean;
	private draftOptions: SelectOption[];
	private numberFormat: NumberFormat;
	private decimals: number | null;
	private min: number | null;
	private max: number | null;
	private linkPath: string;
	private linkFieldId: string;
	private backPath: string;
	private backFieldId: string;
	private backTitleFieldId: string;
	private readonly originalType: FieldType | null;
	private readonly isEditing: boolean;

	private optionsEl: HTMLElement | null = null;
	private numberEl: HTMLElement | null = null;
	private relationEl: HTMLElement | null = null;
	private requiredEl: HTMLElement | null = null;
	private errorEl: HTMLElement | null = null;
	private typeButton: HTMLButtonElement | null = null;
	private typeDropdown: FieldTypeDropdown | null = null;

	constructor(private readonly config: FieldEditorOptions) {
		super(config.app, config.anchor ?? null, FIELD_EDITOR_WIDTH);
		this.isEditing = config.field !== null;
		this.name = config.field?.name ?? '';
		this.type = config.field?.type ?? 'text';
		this.required = config.field?.required === true;
		this.draftOptions = (config.field?.options ?? []).map((o) => ({ ...o }));
		this.numberFormat = normaliseFormat(config.field?.numberFormat);
		this.decimals = normaliseDecimals(config.field?.decimals);
		this.min = config.field?.min ?? null;
		this.max = config.field?.max ?? null;
		this.linkPath = config.field?.linkPath ?? '';
		this.linkFieldId = config.field?.linkFieldId ?? '';
		this.backPath = config.field?.backPath ?? '';
		this.backFieldId = config.field?.backFieldId ?? '';
		this.backTitleFieldId = config.field?.backTitleFieldId ?? '';
		// A path pointing at this very file IS "this table", so it is stored as one.
		if (this.linkPath === config.selfPath) {
			this.linkPath = '';
		}
		if (this.backPath === config.selfPath) {
			this.backPath = '';
		}
		this.linkFieldId = config.field?.linkFieldId ?? '';
		this.originalType = config.field?.type ?? null;
	}

	onOpen(): void {
		super.onOpen();
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('layer-field-editor');

		this.renderTitle();

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

		this.numberEl = contentEl.createDiv({ cls: 'layer-field-number' });
		this.renderNumberSettings();

		this.relationEl = contentEl.createDiv({ cls: 'layer-field-number' });
		this.renderRelationSettings();

		this.requiredEl = contentEl.createDiv({ cls: 'layer-field-required-host' });
		this.renderRequiredToggle();

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

	/**
	 * The panel's own heading. Rendered here rather than through `Modal.setTitle`
	 * because `AnchoredPopover` hides the modal's title element: this panel is
	 * anchored to a control, so a centred title bar above it would be detached
	 * from what it is about.
	 */
	private renderTitle(): void {
		this.contentEl.createDiv({
			cls: 'layer-field-editor-title',
			text: this.isEditing ? t().fieldEditorEditTitle : t().fieldEditorAddTitle,
		});
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
			this.renderNumberSettings();
			this.renderRelationSettings();
			this.renderRequiredToggle();
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
			text: FIELD_TYPE_LABELS[this.type](),
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

			const preview = row.createSpan({ cls: 'layer-field-option-preview' });

			const color = row.createEl('input', {
				cls: 'layer-field-option-color',
				type: 'color',
			});
			color.value = optionColorHex(option.color);

			/*
			 * Repainted in place: swapping the pill for a fresh one keeps the
			 * update off the text input, whose caret and focus a re-render of
			 * the whole list would take with it.
			 */
			const paintPreview = (): void => {
				preview.empty();
				renderOptionPill(
					preview,
					option.name.trim() || t().fieldOptionPlaceholder,
					option.color,
				);
			};
			paintPreview();

			input.addEventListener('input', () => {
				option.name = input.value;
				paintPreview();
			});
			color.addEventListener('input', () => {
				option.color = color.value;
				paintPreview();
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

	/**
	 * The source table and the column behind a relation, in either direction.
	 *
	 * A forward relation names the column whose values it shows; a reverse one
	 * names the `relation` column that points here, so only those are offered.
	 * The column list belongs to another file, so it is filled in once that file
	 * has been read — the table itself is only a list of paths, which is cheap.
	 */
	private renderRelationSettings(): void {
		const host = this.relationEl;
		if (!host) {
			return;
		}
		host.empty();

		const back = this.type === 'relationBack';
		if (this.type !== 'relation' && !back) {
			return;
		}

		host.createEl('h3', {
			text: back ? t().fieldBackLabel : t().fieldRelationLabel,
		});
		const grid = host.createDiv({ cls: 'layer-field-grid' });

		grid.createDiv({
			cls: 'layer-field-label',
			text: t().fieldRelationTableLabel,
		});
		const table = grid.createEl('select', { cls: 'layer-field-number-format' });
		const thisTable = table.createEl('option', {
			text: t().fieldRelationThisTable,
		});
		thisTable.value = '';
		for (const path of this.config.tables.listTables()) {
			// The file being edited is offered as "this table" already, so listing
			// it again would put the same choice in the menu twice.
			if (path === this.config.selfPath) {
				continue;
			}
			const option = table.createEl('option', { text: path });
			option.value = path;
		}
		table.value = back ? this.backPath : this.linkPath;
		table.addEventListener('change', () => {
			if (back) {
				this.backPath = table.value;
				this.backFieldId = '';
				this.backTitleFieldId = '';
			} else {
				this.linkPath = table.value;
				this.linkFieldId = '';
			}
			// The column belongs to the new table, so the old one means nothing.
			this.renderRelationSettings();
		});

		grid.createDiv({
			cls: 'layer-field-label',
			text: t().fieldRelationColumnLabel,
		});
		const column = grid.createEl('select', { cls: 'layer-field-number-format' });
		const columns = this.relationColumns(back ? this.backPath : this.linkPath);
		// A reverse relation can only follow a column that holds links.
		const offered = back
			? (columns ?? []).filter((field) => field.type === 'relation')
			: columns;
		if (offered === null) {
			const pending = column.createEl('option', { text: t().fieldRelationLoading });
			pending.value = '';
			column.disabled = true;
		} else if (offered.length === 0) {
			const empty = column.createEl('option', {
				text: t().fieldRelationNoColumns,
			});
			empty.value = '';
			column.disabled = true;
		} else {
			// Nothing chosen reads as row numbers, which is a real choice rather
			// than an unconfigured state, so it is offered next to the columns.
			const numbers = column.createEl('option', { text: t().fieldRowNumber });
			numbers.value = '';
			for (const field of offered) {
				const option = column.createEl('option', { text: field.name });
				option.value = field.id;
			}
			column.value = back ? this.backFieldId : this.linkFieldId;
			column.addEventListener('change', () => {
				if (back) {
					this.backFieldId = column.value;
				} else {
					this.linkFieldId = column.value;
				}
			});
		}

		if (back) {
			this.renderBackTitle(grid);
		}
	}

	/**
	 * Which column a pointing row is named by, when the reverse column shows its
	 * rows. Nothing chosen reads as the row number.
	 *
	 * Columns whose text form is not a name are left out: a relation column's text
	 * is the ids it holds, which would put identifiers where names belong.
	 */
	private renderBackTitle(grid: HTMLElement): void {
		grid.createDiv({
			cls: 'layer-field-label',
			text: t().fieldBackTitleLabel,
		});
		const select = grid.createEl('select', { cls: 'layer-field-number-format' });
		const numbers = select.createEl('option', { text: t().fieldRowNumber });
		numbers.value = '';
		for (const field of this.relationColumns(this.backPath) ?? []) {
			if (!canNameARow(field)) {
				continue;
			}
			const option = select.createEl('option', { text: field.name });
			option.value = field.id;
		}
		select.value = this.backTitleFieldId;
		select.addEventListener('change', () => {
			this.backTitleFieldId = select.value;
		});
	}

	/**
	 * The columns of the chosen source, or null while that file is still being
	 * read. This table's own columns are already in hand, which is what makes a
	 * self-reference configurable without reading anything.
	 */
	private relationColumns(path: string): readonly Field[] | null {
		if (path === '') {
			return this.config.selfFields;
		}
		const doc = this.config.tables.get(path);
		if (doc) {
			return doc.fields;
		}
		this.config.tables.ensure(path, () => this.renderRelationSettings());
		return null;
	}

	/**
	 * The required toggle, as a checkbox plus its explanation: "required" alone
	 * does not say what it constrains, and the consequence is invisible until a
	 * cell is left empty.
	 *
	 * A derived field has no cells of its own to fill, so the toggle is not
	 * offered for it — and the flag is dropped, so one is never saved onto it.
	 */
	private renderRequiredToggle(): void {
		const host = this.requiredEl;
		if (!host) {
			return;
		}
		host.empty();

		if (this.type === 'relationBack') {
			this.required = false;
			return;
		}

		const wrap = host.createDiv({ cls: 'layer-field-required' });

		const label = wrap.createEl('label', { cls: 'layer-field-required-label' });
		const box = label.createEl('input', {
			cls: 'layer-field-required-box',
			type: 'checkbox',
		});
		box.checked = this.required;
		label.createSpan({ text: t().fieldRequiredLabel });
		box.addEventListener('change', () => {
			this.required = box.checked;
		});

		wrap.createDiv({
			cls: 'layer-field-required-hint',
			text: t().fieldRequiredHint,
		});
	}

	/**
	 * Format, precision and bounds, which only a `number` field has.
	 *
	 * Every bound is optional, and an empty box means "no bound" rather than
	 * zero — so a field with a minimum but no maximum is expressible.
	 */
	private renderNumberSettings(): void {
		const host = this.numberEl;
		if (!host) {
			return;
		}
		host.empty();

		if (this.type !== 'number') {
			return;
		}

		host.createEl('h3', { text: t().fieldNumberLabel });
		const grid = host.createDiv({ cls: 'layer-field-grid' });

		grid.createDiv({
			cls: 'layer-field-label',
			text: t().fieldNumberFormatLabel,
		});
		const format = grid.createEl('select', { cls: 'layer-field-number-format' });
		for (const value of ['plain', 'percent'] as const) {
			const option = format.createEl('option', {
				text:
					value === 'percent'
						? t().fieldNumberFormatPercent
						: t().fieldNumberFormatPlain,
			});
			option.value = value;
		}
		format.value = this.numberFormat;
		format.addEventListener('change', () => {
			this.numberFormat = format.value === 'percent' ? 'percent' : 'plain';
		});

		grid.createDiv({
			cls: 'layer-field-label',
			text: t().fieldNumberDecimalsLabel,
		});
		const decimals = grid.createEl('input', {
			cls: 'layer-field-number-input',
			type: 'number',
		});
		decimals.min = '0';
		decimals.max = String(MAX_DECIMALS);
		decimals.step = '1';
		decimals.placeholder = t().fieldNumberDecimalsHint;
		decimals.value = this.decimals === null ? '' : String(this.decimals);
		decimals.addEventListener('input', () => {
			const parsed = parseOptionalNumber(decimals.value);
			this.decimals = parsed === null ? null : normaliseDecimals(parsed);
		});

		this.renderBoundInput(grid, t().fieldNumberMinLabel, 'min');
		this.renderBoundInput(grid, t().fieldNumberMaxLabel, 'max');

		host.createDiv({
			cls: 'layer-field-number-hint',
			text: t().fieldNumberHint,
		});
	}

	/** One optional bound, written into the draft as it is typed. */
	private renderBoundInput(
		grid: HTMLElement,
		label: string,
		bound: 'min' | 'max',
	): void {
		grid.createDiv({ cls: 'layer-field-label', text: label });
		const input = grid.createEl('input', {
			cls: 'layer-field-number-input',
			type: 'number',
		});
		input.placeholder = t().fieldNumberUnbounded;
		const current = bound === 'min' ? this.min : this.max;
		input.value = current === null ? '' : String(current);
		input.addEventListener('input', () => {
			const parsed = parseOptionalNumber(input.value);
			if (bound === 'min') {
				this.min = parsed;
			} else {
				this.max = parsed;
			}
		});
	}

	private submit(): void {
		const name = this.name.trim();
		if (!name) {
			this.errorEl?.setText(t().fieldNameRequired);
			return;
		}
		// A range that excludes everything would only produce clamped values, so it
		// is refused while it can still be corrected.
		if (
			this.type === 'number' &&
			this.min !== null &&
			this.max !== null &&
			this.min > this.max
		) {
			this.errorEl?.setText(t().fieldNumberRangeError);
			return;
		}

		this.config.onSubmit({
			name,
			type: this.type,
			options: this.draftOptions.filter((o) => o.name.trim() !== ''),
			required: this.required,
			number: {
				format: this.numberFormat,
				decimals: this.decimals,
				min: this.min,
				max: this.max,
			},
			relation: {
				path: this.linkPath,
				fieldId: this.linkFieldId,
			},
			back: {
				path: this.backPath,
				fieldId: this.backFieldId,
				titleFieldId: this.backTitleFieldId,
			},
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
