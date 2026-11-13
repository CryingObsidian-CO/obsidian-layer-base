import { setIcon, setTooltip, type App } from 'obsidian';
import { t } from '../i18n';
import { capabilityOf } from '../model/capabilities';
import { canBeRequired, isDerived, specFor, usesOptions } from '../model/fields';
import {
	MAX_DECIMALS,
	normaliseDecimals,
	normaliseFormat,
	parseOptionalNumber,
	shownNumber,
	storedNumber,
} from '../model/number';
import {
	nextOptionColor,
	optionColorHex,
	reorderOption,
} from '../model/select-options';
import { aggregatesFor } from '../model/rollup';
import { fieldsUsed, parseFormula } from '../model/formula/parser';
import { formulaErrorMessage } from './formula-text';
import type { TableIndex } from '../io/table-index';
import type {
	Field,
	FieldType,
	FormulaResultType,
	NumberFormat,
	RollupAggregate,
	SelectOption,
} from '../types';
import { generateId } from '../utils/id';
import { AnchoredPopover, type Anchor } from './anchored-popover';
import { FieldTypeDropdown } from './field-type-picker';
import { FormulaModal } from './formula-modal';

export interface NumberSettings {
	format: NumberFormat;
	decimals: number | null;
	min: number | null;
	max: number | null;
}

export interface RelationSettings {
	/** The `.layer` file, or `''` for this table. */
	path: string;
	fieldId: string;
}

export interface BackSettings extends RelationSettings {
	/** The column a pointing row is named by; `''` for its row number. */
	titleFieldId: string;
}

export interface AutoNumberSettings {
	length: number;
	/** The column numbered separately; '' numbers the whole table as one. */
	groupFieldId: string;
}

export interface RollupSettings {
	/** The relation column in this table whose rows are gathered; `''` for none. */
	sourceFieldId: string;
	/** The column read from those rows; `''` for none. */
	fieldId: string;
	aggregate: RollupAggregate;
}

export interface LookupSettings {
	/** The relation column in this table whose rows are read; `''` for none. */
	sourceFieldId: string;
	/** The column read from those rows; `''` for none. */
	fieldId: string;
}

export interface FieldEditorResult {
	name: string;
	type: FieldType;
	options: SelectOption[];
	required: boolean;
	number: NumberSettings;
	relation: RelationSettings;
	back: BackSettings;
	formula: string;
	autoNumber: AutoNumberSettings;
	rollup: RollupSettings;
	lookup: LookupSettings;
	noteProp: { sourceFieldId: string; key: string };
	formulaType: FormulaResultType | null;
	typeChanged: boolean;
}

export interface FieldEditorOptions {
	app: App;
	field: Field | null;
	/** What the panel opens next to; null centres it. */
	anchor?: Anchor | null;
	tables: TableIndex;
	/** This document's own columns, so a self-reference needs no read. */
	selfFields: readonly Field[];
	/** This document's own vault path, kept out of the list to avoid a duplicate. */
	selfPath: string;
	onSubmit: (result: FieldEditorResult) => void;
}

/** Applied inline by `AnchoredPopover`: a modal's own width only moves with `!important`. */
const FIELD_EDITOR_WIDTH = '17rem';

/** Read lazily, so a language change is picked up rather than frozen at load. */
const FIELD_TYPE_LABELS: Record<FieldType, () => string> = {
	text: () => t().typeText,
	longtext: () => t().typeLongText,
	number: () => t().typeNumber,
	date: () => t().typeDate,
	datetime: () => t().typeDateTime,
	relation: () => t().typeRelation,
	relationBack: () => t().typeRelationBack,
	autoNumber: () => t().typeAutoNumber,
	rollup: () => t().typeRollup,
	lookup: () => t().typeLookup,
	formula: () => t().typeFormula,
	select: () => t().typeSelect,
	multiSelect: () => t().typeMultiSelect,
	checkbox: () => t().typeCheckbox,
	note: () => t().typeNote,
	noteProp: () => t().typeNoteProp,
};

function canNameARow(field: Field): boolean {
	return capabilityOf(field.type).namesARow;
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
	private noteSourceId: string;
	private noteKey: string;
	private backPath: string;
	private backFieldId: string;
	private backTitleFieldId: string;
	private rollupSourceFieldId: string;
	private rollupFieldId: string;
	private rollupAggregate: RollupAggregate;
	private lookupSourceFieldId: string;
	private lookupFieldId: string;
	private numberLength: number;
	private numberGroupFieldId: string;
	private formula: string;
	private formulaType: FormulaResultType | null;
	private readonly originalType: FieldType | null;
	private readonly isEditing: boolean;

	private optionsEl: HTMLElement | null = null;
	// The rows' own box: "the end of the list" is before the add button, not the panel's end.
	private optionListEl: HTMLElement | null = null;
	private numberEl: HTMLElement | null = null;
	private relationEl: HTMLElement | null = null;
	private rollupEl: HTMLElement | null = null;
	private lookupEl: HTMLElement | null = null;
	private autoNumberEl: HTMLElement | null = null;
	private notePropEl: HTMLElement | null = null;
	private formulaEl: HTMLElement | null = null;
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
		this.rollupSourceFieldId = config.field?.rollupSourceFieldId ?? '';
		this.rollupFieldId = config.field?.rollupFieldId ?? '';
		this.lookupSourceFieldId = config.field?.lookupSourceFieldId ?? '';
		this.lookupFieldId = config.field?.lookupFieldId ?? '';
		this.rollupAggregate = config.field?.rollupAggregate ?? 'sum';
		this.noteSourceId = config.field?.noteFieldId ?? '';
		this.noteKey = config.field?.frontmatterKey ?? '';
		this.numberLength = config.field?.numberLength ?? 1;
		this.numberGroupFieldId = config.field?.numberGroupFieldId ?? '';
		this.formula = config.field?.formula ?? '';
		this.formulaType = config.field?.formulaType ?? null;
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
		// Kept from taking focus: the click would claim it after the dropdown put the caret in its box.
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

		this.rollupEl = contentEl.createDiv({ cls: 'layer-field-number' });
		this.renderRollupSettings();

		this.lookupEl = contentEl.createDiv({ cls: 'layer-field-number' });
		this.renderLookupSettings();

		this.autoNumberEl = contentEl.createDiv({ cls: 'layer-field-number' });
		this.renderAutoNumberSettings();

		this.formulaEl = contentEl.createDiv({ cls: 'layer-field-number' });
		this.renderFormulaSettings();

		this.notePropEl = contentEl.createDiv({ cls: 'layer-field-number' });
		this.renderNotePropSettings();

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

	/** Its own heading: `AnchoredPopover` hides the modal title, which would hang above an anchored panel. */
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
			this.renderRollupSettings();
			this.renderLookupSettings();
			this.renderAutoNumberSettings();
			this.renderFormulaSettings();
			this.renderNotePropSettings();
			this.renderRequiredToggle();
		});
	}

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

	private renderOptions(): void {
		const host = this.optionsEl;
		if (!host) {
			return;
		}
		host.empty();
		// Emptied with the panel: a pointer drag may still be holding the old box.
		this.optionListEl = null;

		if (!usesOptions(this.type)) {
			return;
		}

		host.createEl('h3', { text: t().fieldOptionsLabel });
		this.optionListEl = host.createDiv({ cls: 'layer-field-option-list' });
		const list = this.optionListEl;

		for (const option of this.draftOptions) {
			const row = list.createDiv({ cls: 'layer-field-option-row' });
			row.dataset.optionId = option.id;

			// This order is the field's: the board draws its columns in it and the table sorts by it.
			const handle = row.createEl('button', {
				cls: 'layer-field-option-handle',
			});
			handle.type = 'button';
			handle.setAttribute('aria-label', t().fieldMoveOption);
			setTooltip(handle, t().fieldMoveOption);
			setIcon(handle, 'grip-vertical');
			this.attachOptionDrag(handle, row, option.id);

			const input = row.createEl('input', {
				cls: 'layer-field-option-input',
				type: 'text',
			});
			input.placeholder = t().fieldOptionPlaceholder;
			input.value = option.name;
			input.addEventListener('input', () => {
				option.name = input.value;
			});

			const color = row.createEl('input', {
				cls: 'layer-field-option-color',
				type: 'color',
			});
			color.value = optionColorHex(option.color);
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
			// The colour the cell dropdown would hand it, so an option looks the same however it was made.
			this.draftOptions.push({
				id: generateId('o'),
				name: '',
				color: nextOptionColor(this.draftOptions),
			});
			this.renderOptions();
		});
	}

	/**
	 * Listens on the document, not the handle: the row moves under the pointer, and a re-render
	 * per crossing would take the focus and the carets with it.
	 */
	private attachOptionDrag(
		handle: HTMLElement,
		row: HTMLElement,
		optionId: string,
	): void {
		handle.addEventListener('pointerdown', (event: PointerEvent) => {
			if (event.pointerType === 'mouse' && event.button !== 0) {
				return;
			}
			const list = this.optionListEl;
			if (!list) {
				return;
			}
			// Nothing else may happen on this press: no text selection, no scroll.
			event.preventDefault();

			let dragging = false;
			const rows = (): HTMLElement[] =>
				Array.from(
					list.querySelectorAll<HTMLElement>('.layer-field-option-row'),
				);

			const onMove = (move: PointerEvent): void => {
				if (!row.isConnected) {
					stop();
					return;
				}
				if (!dragging) {
					dragging = true;
					row.addClass('is-dragging');
				}
				const others = rows().filter((other) => other !== row);
				// Counted over the other rows, which is also the index it takes once taken out.
				let target = others.length;
				for (const [index, other] of others.entries()) {
					const box = other.getBoundingClientRect();
					if (move.clientY < box.top + box.height / 2) {
						target = index;
						break;
					}
				}
				const next = reorderOption(this.draftOptions, optionId, target);
				if (!next) {
					return;
				}
				this.draftOptions = next;
				list.insertBefore(row, others[target] ?? null);
			};

			function stop(): void {
				document.removeEventListener('pointermove', onMove);
				document.removeEventListener('pointerup', stop);
				document.removeEventListener('pointercancel', stop);
				row.removeClass('is-dragging');
			}

			document.addEventListener('pointermove', onMove);
			document.addEventListener('pointerup', stop);
			document.addEventListener('pointercancel', stop);
		});

		handle.addEventListener('keydown', (event: KeyboardEvent) => {
			const step =
				event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
			if (step === 0) {
				return;
			}
			event.preventDefault();
			const from = this.draftOptions.findIndex((one) => one.id === optionId);
			const next = reorderOption(this.draftOptions, optionId, from + step);
			if (!next) {
				return;
			}
			this.draftOptions = next;
			this.renderOptions();
			// The list is rebuilt, so the handle must be found again or a keyboard user loses their place.
			this.optionListEl
				?.querySelector<HTMLElement>(
					`.layer-field-option-row[data-option-id="${optionId}"] .layer-field-option-handle`,
				)
				?.focus();
		});
	}

	private renderNotePropSettings(): void {
		const host = this.notePropEl;
		if (!host) {
			return;
		}
		host.empty();
		if (this.type !== 'noteProp') {
			return;
		}

		host.createEl('h3', { text: t().typeNoteProp });
		const grid = host.createDiv({ cls: 'layer-field-grid' });

		grid.createDiv({
			cls: 'layer-field-label',
			text: t().fieldNoteSourceLabel,
		});
		const source = grid.createEl('select', { cls: 'layer-field-number-format' });
		const none = source.createEl('option', { text: '—' });
		none.value = '';
		for (const field of this.config.selfFields) {
			if (field.type !== 'note') {
				continue;
			}
			const option = source.createEl('option', { text: field.name });
			option.value = field.id;
		}
		source.value = this.noteSourceId;
		source.addEventListener('change', () => {
			this.noteSourceId = source.value;
		});

		grid.createDiv({
			cls: 'layer-field-label',
			text: t().fieldFrontmatterKeyLabel,
		});
		const key = grid.createEl('input', {
			type: 'text',
			cls: 'layer-field-number-format',
		});
		// An empty key means the field's own name, which is what the placeholder shows.
		key.placeholder = this.name.trim();
		key.value = this.noteKey;
		key.addEventListener('input', () => {
			this.noteKey = key.value;
		});
	}

	/**
	 * A forward relation names the column whose values it shows; a reverse one names the
	 * `relation` column pointing here, so only those are offered.
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
			// Offered as "this table" already; listing it again would put the same choice in twice.
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
			// Nothing chosen reads as row numbers, a real choice, so it is offered next to the columns.
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
	 * Only a column whose text form is a name is offered: a relation's text is the ids it
	 * holds, which would put identifiers where names belong.
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

	/** This table's own columns need no read; `null` means that file is still being read. */
	private relationColumns(path: string): readonly Field[] | null {
		if (path === '') {
			return this.config.selfFields;
		}
		const doc = this.config.tables.get(path);
		if (doc) {
			return doc.fields;
		}
		// Every section that reads a linked table repaints when it lands, not just the relation
		// one: a rollup and a lookup read theirs through this same call, and a read can land
		// after the panel closed, so nothing is painted into a panel no longer on screen.
		this.config.tables.ensure(path, () => {
			if (!this.contentEl.isConnected) {
				return;
			}
			this.renderRelationSettings();
			this.renderRollupSettings();
			this.renderLookupSettings();
		});
		return null;
	}

	private renderRollupSettings(): void {
		const host = this.rollupEl;
		if (!host) {
			return;
		}
		host.empty();

		if (this.type !== 'rollup') {
			return;
		}

		host.createEl('h3', { text: t().fieldRollupLabel });

		const sourceGrid = host.createDiv({ cls: 'layer-field-grid' });
		sourceGrid.createDiv({ cls: 'layer-field-label', text: t().fieldRollupSource });
		const sourceSelect = sourceGrid.createEl('select', {
			cls: 'layer-field-number-format',
		});
		const none = sourceSelect.createEl('option', { text: t().fieldRollupNone });
		none.value = '';
		for (const field of this.config.selfFields) {
			if (field.type !== 'relation' && field.type !== 'relationBack') {
				continue;
			}
			if (field.id === this.config.field?.id) {
				continue;
			}
			const option = sourceSelect.createEl('option', { text: field.name });
			option.value = field.id;
		}
		sourceSelect.value = this.rollupSourceFieldId;
		sourceSelect.addEventListener('change', () => {
			this.rollupSourceFieldId = sourceSelect.value;
			this.rollupFieldId = '';
			this.renderRollupSettings();
		});

		const sourceField = this.config.selfFields.find(
			(field) => field.id === this.rollupSourceFieldId,
		);
		if (!sourceField) {
			const hasLink = this.config.selfFields.some(
				(field) =>
					field.type === 'relation' || field.type === 'relationBack',
			);
			host.createDiv({
				cls: 'layer-field-number-hint',
				text: hasLink ? t().fieldRollupHint : t().fieldRollupNoRelation,
			});
			return;
		}

		const columns = this.linkedColumns(sourceField);
		const fieldGrid = host.createDiv({ cls: 'layer-field-grid' });
		fieldGrid.createDiv({ cls: 'layer-field-label', text: t().fieldRollupField });
		const fieldSelect = fieldGrid.createEl('select', {
			cls: 'layer-field-number-format',
		});
		const noColumn = fieldSelect.createEl('option', {
			text: t().fieldRollupNone,
		});
		noColumn.value = '';
		for (const field of columns ?? []) {
			if (isDerived(field.type)) {
				// A computed column cannot be gathered: it would run every linked row's formula.
				continue;
			}
			const option = fieldSelect.createEl('option', { text: field.name });
			option.value = field.id;
		}
		fieldSelect.value = this.rollupFieldId;
		fieldSelect.addEventListener('change', () => {
			this.rollupFieldId = fieldSelect.value;
			this.clampRollupAggregate();
			this.renderRollupSettings();
		});

		const targetField = (columns ?? []).find(
			(field) => field.id === this.rollupFieldId,
		);
		if (!targetField) {
			host.createDiv({
				cls: 'layer-field-number-hint',
				text: t().fieldRollupHint,
			});
			return;
		}

		const allowed = aggregatesFor(targetField.type);
		this.clampRollupAggregate();
		const howGrid = host.createDiv({ cls: 'layer-field-grid' });
		howGrid.createDiv({ cls: 'layer-field-label', text: t().fieldRollupAggregate });
		const howSelect = howGrid.createEl('select', {
			cls: 'layer-field-number-format',
		});
		for (const how of allowed) {
			const option = howSelect.createEl('option', {
				text: this.aggregateLabel(how),
			});
			option.value = how;
		}
		howSelect.value = this.rollupAggregate;
		howSelect.addEventListener('change', () => {
			this.rollupAggregate = howSelect.value as RollupAggregate;
		});

		host.createDiv({ cls: 'layer-field-number-hint', text: t().fieldRollupHint });
	}

	/** A link column here, and a column of the table it points at: a rollup's pair minus the reduction. */
	private renderLookupSettings(): void {
		const host = this.lookupEl;
		if (!host) {
			return;
		}
		host.empty();

		if (this.type !== 'lookup') {
			return;
		}

		host.createEl('h3', { text: t().fieldLookupLabel });

		const links = this.config.selfFields.filter(
			(field) =>
				(field.type === 'relation' || field.type === 'relationBack') &&
				field.id !== this.config.field?.id,
		);

		const sourceGrid = host.createDiv({ cls: 'layer-field-grid' });
		sourceGrid.createDiv({ cls: 'layer-field-label', text: t().fieldLookupSource });
		const sourceSelect = sourceGrid.createEl('select', {
			cls: 'layer-field-number-format',
		});
		const none = sourceSelect.createEl('option', { text: t().fieldRollupNone });
		none.value = '';
		for (const field of links) {
			const option = sourceSelect.createEl('option', { text: field.name });
			option.value = field.id;
		}
		sourceSelect.value = this.lookupSourceFieldId;
		sourceSelect.addEventListener('change', () => {
			this.lookupSourceFieldId = sourceSelect.value;
			// Starts from the column the link column already shows: a starting point, not a rule.
			const chosen = links.find((field) => field.id === sourceSelect.value);
			this.lookupFieldId = chosen ? this.defaultLinkColumn(chosen) : '';
			this.renderLookupSettings();
		});

		const sourceField = links.find(
			(field) => field.id === this.lookupSourceFieldId,
		);
		if (!sourceField) {
			host.createDiv({
				cls: 'layer-field-number-hint',
				text: links.length > 0 ? t().fieldLookupHint : t().fieldLookupNoRelation,
			});
			return;
		}

		const columns = this.linkedColumns(sourceField);
		const fieldGrid = host.createDiv({ cls: 'layer-field-grid' });
		fieldGrid.createDiv({ cls: 'layer-field-label', text: t().fieldLookupField });
		const fieldSelect = fieldGrid.createEl('select', {
			cls: 'layer-field-number-format',
		});
		const noColumn = fieldSelect.createEl('option', {
			text: t().fieldRollupNone,
		});
		noColumn.value = '';
		for (const field of columns ?? []) {
			if (isDerived(field.type)) {
				continue;
			}
			const option = fieldSelect.createEl('option', { text: field.name });
			option.value = field.id;
		}
		fieldSelect.value = this.lookupFieldId;
		fieldSelect.addEventListener('change', () => {
			this.lookupFieldId = fieldSelect.value;
			this.renderLookupSettings();
		});

		host.createDiv({ cls: 'layer-field-number-hint', text: t().fieldLookupHint });
	}

	/** A `relation` names it in `linkFieldId`, a `relationBack` in `backTitleFieldId`; a derived or missing column answers `''`. */
	private defaultLinkColumn(sourceField: Field): string {
		const wanted =
			sourceField.type === 'relation'
				? sourceField.linkFieldId
				: sourceField.backTitleFieldId;
		if (wanted === undefined || wanted === '') {
			return '';
		}
		const columns = this.linkedColumns(sourceField) ?? [];
		const column = columns.find((field) => field.id === wanted);
		return column && !isDerived(column.type) ? column.id : '';
	}

	private aggregateLabel(how: RollupAggregate): string {
		switch (how) {
			case 'sum':
				return t().rollupSum;
			case 'average':
				return t().rollupAverage;
			case 'min':
				return t().rollupMin;
			case 'max':
				return t().rollupMax;
			case 'count':
				return t().rollupCount;
			default:
				return t().rollupCountAll;
		}
	}

	/** No prefix: it would stop the column being a number, and a formula can build one. */
	private renderAutoNumberSettings(): void {
		const host = this.autoNumberEl;
		if (!host) {
			return;
		}
		host.empty();

		if (this.type !== 'autoNumber') {
			return;
		}

		host.createEl('h3', { text: t().fieldAutoNumberLabel });

		const lengthGrid = host.createDiv({ cls: 'layer-field-grid' });
		lengthGrid.createDiv({
			cls: 'layer-field-label',
			text: t().fieldAutoNumberLength,
		});
		const lengthInput = lengthGrid.createEl('input', {
			cls: 'layer-field-number-format',
			type: 'number',
		});
		lengthInput.min = '1';
		lengthInput.max = '12';
		lengthInput.value = String(this.numberLength);
		lengthInput.addEventListener('input', () => {
			const parsed = Number(lengthInput.value);
			this.numberLength =
				Number.isFinite(parsed) && parsed >= 1 ? Math.min(Math.floor(parsed), 12) : 1;
		});

		const groupGrid = host.createDiv({ cls: 'layer-field-grid' });
		groupGrid.createDiv({
			cls: 'layer-field-label',
			text: t().fieldAutoNumberGroup,
		});
		const groupSelect = groupGrid.createEl('select', {
			cls: 'layer-field-number-format',
		});
		const whole = groupSelect.createEl('option', {
			text: t().fieldAutoNumberNoGroup,
		});
		whole.value = '';
		for (const field of this.config.selfFields) {
			// Numbering by itself would be a cycle; a computed column has no number.
			if (field.id === this.config.field?.id || isDerived(field.type)) {
				continue;
			}
			const option = groupSelect.createEl('option', { text: field.name });
			option.value = field.id;
		}
		groupSelect.value = this.numberGroupFieldId;
		groupSelect.addEventListener('change', () => {
			this.numberGroupFieldId = groupSelect.value;
		});

		host.createDiv({
			cls: 'layer-field-number-hint',
			text: t().fieldAutoNumberHint,
		});
	}

	/** Keeps the chosen aggregate one the chosen column can answer. */
	private clampRollupAggregate(): void {
		const sourceField = this.config.selfFields.find(
			(field) => field.id === this.rollupSourceFieldId,
		);
		if (!sourceField) {
			return;
		}
		const target = this.linkedColumns(sourceField)?.find(
			(field) => field.id === this.rollupFieldId,
		);
		if (!target) {
			return;
		}
		const allowed = aggregatesFor(target.type);
		if (!allowed.includes(this.rollupAggregate)) {
			this.rollupAggregate = allowed[0] ?? 'count';
		}
	}

	private linkedColumns(sourceField: Field): readonly Field[] | null {
		const path =
			sourceField.type === 'relation'
				? (sourceField.linkPath ?? '')
				: (sourceField.backPath ?? '');
		return this.relationColumns(path);
	}

	/** Writing one wants room and its own reference lists, so it opens a centred panel; this keeps what it reports. */
	private renderFormulaSettings(): void {
		const host = this.formulaEl;
		if (!host) {
			return;
		}
		host.empty();

		if (this.type !== 'formula') {
			return;
		}

		host.createEl('h3', { text: t().fieldFormulaLabel });

		const button = host.createEl('button', {
			cls: 'layer-field-formula-open',
		});
		const icon = button.createSpan({ cls: 'layer-field-formula-open-icon' });
		setIcon(icon, 'sigma');
		const shown = this.formula.trim() === '' ? t().formulaOpenEmpty : this.formula;
		button.createSpan({ cls: 'layer-field-formula-open-text', text: shown });
		// Held to one line so it cannot run out of the button, so the hover carries the whole of it.
		setTooltip(button, shown);
		button.addEventListener('click', () => this.openFormulaEditor());

		const status = host.createDiv({ cls: 'layer-field-formula-status' });
		this.paintFormulaStatus(status);
	}

	private openFormulaEditor(): void {
		new FormulaModal({
			app: this.app,
			formula: this.formula,
			formulaType: this.formulaType,
			fields: this.config.selfFields.filter(
				(field) => field.id !== this.config.field?.id,
			),
			onSubmit: (result) => {
				this.formula = result.formula;
				this.formulaType = result.formulaType;
				if (this.formulaEl) {
					this.renderFormulaSettings();
				}
			},
		}).open();
	}

	private paintFormulaStatus(status: HTMLElement): void {
		status.empty();
		status.removeClass('is-error', 'is-ok');
		if (this.formula.trim() === '') {
			return;
		}
		const parsed = parseFormula(this.formula);
		if (!parsed.ok) {
			status.addClass('is-error');
			status.setText(formulaErrorMessage(parsed.error));
			return;
		}
		const names = this.config.selfFields
			.filter((field) => field.id !== this.config.field?.id)
			.map((field) => field.name);
		const missing = [...fieldsUsed(parsed.node)].filter(
			(name) => !names.includes(name),
		);
		if (missing.length > 0) {
			status.addClass('is-error');
			status.setText(`${t().fieldFormulaError} ${missing.join(', ')}`);
			return;
		}
		status.addClass('is-ok');
		status.setText(t().fieldFormulaOk);
	}

	/** Not offered for a column the table fills in itself, and the flag is cleared so one is never saved. */
	private renderRequiredToggle(): void {
		const host = this.requiredEl;
		if (!host) {
			return;
		}
		host.empty();

		if (!canBeRequired(this.type)) {
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

	/** Every bound is optional: an empty box means "no bound", not zero. */
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
			// Bounds are stored as proportions, so a format switch must redraw the boxes in new units.
			this.renderNumberSettings();
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
		// Stored as a proportion, shown in the units the cells use: a percent maximum of 100 is one.
		input.value = current === null ? '' : String(shownNumber(current, this.numberFormat));
		input.addEventListener('input', () => {
			const parsed = parseOptionalNumber(input.value);
			const stored = parsed === null ? null : storedNumber(parsed, this.numberFormat);
			if (bound === 'min') {
				this.min = stored;
			} else {
				this.max = stored;
			}
		});
	}

	private submit(): void {
		const name = this.name.trim();
		if (!name) {
			this.errorEl?.setText(t().fieldNameRequired);
			return;
		}
		// A range that excludes everything would only produce clamped values, so it is refused here.
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
			autoNumber: {
				length: this.numberLength,
				groupFieldId: this.numberGroupFieldId,
			},
			rollup: {
				sourceFieldId: this.rollupSourceFieldId,
				fieldId: this.rollupFieldId,
				aggregate: this.rollupAggregate,
			},
			lookup: {
				sourceFieldId: this.lookupSourceFieldId,
				fieldId: this.lookupFieldId,
			},
			formula: this.formula.trim(),
			formulaType: this.formulaType,
			noteProp: {
				sourceFieldId: this.noteSourceId,
				key: this.noteKey,
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
		this.optionsEl = null;
		this.optionListEl = null;
	}
}