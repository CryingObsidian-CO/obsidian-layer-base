import { setIcon } from 'obsidian';
import { t } from '../i18n';
import type { Field, Filter, FilterCondition, FilterOperator } from '../types';
import { isFilterable, needsValue, operatorsFor } from '../model/filter';
import { AnchoredPopover, type Anchor } from './anchored-popover';

const FILTER_POPOVER_WIDTH = '26rem';

export interface FilterPopoverOptions {
	app: AnchoredPopover['app'];
	anchor: Anchor | null;
	/** The columns that may be filtered on, in the order the table shows them. */
	fields: readonly Field[];
	filter: Filter;
	/** Reported on every change, so the table follows the panel as it is edited. */
	onChange: (filter: Filter) => void;
}

/**
 * The filter rules of a view, in a panel beside the toolbar.
 *
 * Conditions are combined as a whole, not in groups: the model has one conjunction
 * and a list, so the panel offers a single choice between "all" and "any" rather
 * than inventing a tree of conditions it could not save.
 */
export class FilterPopover extends AnchoredPopover {
	private conjunction: 'and' | 'or';
	private conditions: FilterCondition[];

	constructor(private readonly config: FilterPopoverOptions) {
		super(config.app, config.anchor, FILTER_POPOVER_WIDTH);
		this.conjunction = config.filter.conjunction;
		this.conditions = config.filter.conditions.map((condition) => ({
			...condition,
		}));
	}

	onOpen(): void {
		super.onOpen();
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('layer-filter-panel');

		contentEl.createEl('h2', { cls: 'layer-filter-title', text: t().filterTitle });

		if (this.conditions.length === 0) {
			contentEl.createDiv({
				cls: 'layer-filter-empty',
				text: t().filterEmpty,
			});
		} else if (this.conditions.length > 1) {
			this.renderConjunction(contentEl);
		}

		for (const condition of this.conditions) {
			this.renderCondition(contentEl, condition);
		}

		const add = contentEl.createEl('button', { cls: 'layer-filter-add' });
		setIcon(add.createSpan({ cls: 'layer-filter-add-icon' }), 'plus');
		add.createSpan({ text: t().filterAdd });
		add.addEventListener('click', (event) => {
			event.preventDefault();
			this.addCondition();
		});

		this.position();
	}

	/** The single choice between requiring all conditions or any of them. */
	private renderConjunction(host: HTMLElement): void {
		const row = host.createDiv({ cls: 'layer-filter-conjunction' });
		for (const option of ['and', 'or'] as const) {
			const button = row.createEl('button', { cls: 'layer-filter-mode' });
			button.toggleClass('is-active', this.conjunction === option);
			button.setText(option === 'and' ? t().filterAll : t().filterAny);
			button.addEventListener('click', (event) => {
				event.preventDefault();
				this.conjunction = option;
				this.emit();
				this.render();
			});
		}
	}

	private renderCondition(host: HTMLElement, condition: FilterCondition): void {
		const field = this.config.fields.find(
			(candidate) => candidate.id === condition.fieldId,
		);
		const row = host.createDiv({ cls: 'layer-filter-rule' });

		const fieldSelect = row.createEl('select', { cls: 'layer-filter-field' });
		for (const candidate of this.filterableFields()) {
			const option = fieldSelect.createEl('option', { text: candidate.name });
			option.value = candidate.id;
		}
		fieldSelect.value = condition.fieldId;
		fieldSelect.addEventListener('change', () => {
			condition.fieldId = fieldSelect.value;
			// The operators belong to the column, so a new column starts over.
			const next = this.config.fields.find(
				(candidate) => candidate.id === fieldSelect.value,
			);
			const allowed = next ? operatorsFor(next) : [];
			condition.operator = allowed[0] ?? 'is';
			delete condition.value;
			this.emit();
			this.render();
		});

		const operatorSelect = row.createEl('select', { cls: 'layer-filter-operator' });
		const allowed = field ? operatorsFor(field) : [];
		for (const operator of allowed) {
			const option = operatorSelect.createEl('option', {
				text: this.operatorLabel(operator),
			});
			option.value = operator;
		}
		operatorSelect.value = allowed.includes(condition.operator)
			? condition.operator
			: allowed[0] ?? 'is';
		operatorSelect.addEventListener('change', () => {
			condition.operator = operatorSelect.value as FilterOperator;
			this.emit();
			this.render();
		});

		// A value is only asked for when the operator needs one.
		if (field && needsValue(condition.operator)) {
			this.renderValue(row, field, condition);
		}

		const remove = row.createEl('button', { cls: 'layer-filter-remove' });
		setIcon(remove.createSpan(), 'x');
		remove.setAttribute('aria-label', t().filterRemove);
		remove.addEventListener('click', (event) => {
			event.preventDefault();
			this.conditions = this.conditions.filter(
				(candidate) => candidate !== condition,
			);
			this.emit();
			this.render();
		});
	}

	/** The value input, shaped for what the column holds. */
	private renderValue(
		host: HTMLElement,
		field: Field,
		condition: FilterCondition,
	): void {
		if (field.type === 'select' || field.type === 'multiSelect') {
			// A choice is picked from the names the cell shows, not typed from memory.
			const select = host.createEl('select', { cls: 'layer-filter-value' });
			const any = select.createEl('option', { text: t().filterAnyValue });
			any.value = '';
			for (const option of field.options ?? []) {
				const entry = select.createEl('option', { text: option.name });
				entry.value = option.name;
			}
			select.value = condition.value === undefined ? '' : String(condition.value);
			select.addEventListener('change', () => {
				condition.value = select.value;
				this.emit();
			});
			return;
		}

		const input = host.createEl('input', { cls: 'layer-filter-value' });
		if (field.type === 'date' || field.type === 'datetime') {
			input.type = 'date';
		} else if (field.type === 'number' || field.type === 'autoNumber') {
			input.type = 'number';
		} else {
			input.type = 'text';
		}
		if (field.type === 'relation') {
			// The names a relation shows live in another table, which this panel
			// cannot read, so the placeholder says what is expected rather than
			// offering a list it would have to guess at.
			input.placeholder = t().filterRelationPlaceholder;
		}
		input.value = condition.value === undefined ? '' : String(condition.value);
		input.addEventListener('input', () => {
			condition.value =
				field.type === 'number' || field.type === 'autoNumber'
					? Number(input.value)
					: input.value;
			this.emit();
		});
	}

	/** What one operator is called in the reader's language. */
	private operatorLabel(operator: FilterOperator): string {
		switch (operator) {
			case 'is':
				return t().filterOpIs;
			case 'isNot':
				return t().filterOpIsNot;
			case 'contains':
				return t().filterOpContains;
			case 'notContains':
				return t().filterOpNotContains;
			case 'isEmpty':
				return t().filterOpIsEmpty;
			case 'isNotEmpty':
				return t().filterOpIsNotEmpty;
			case 'greaterThan':
				return t().filterOpGreater;
			case 'lessThan':
				return t().filterOpLess;
			case 'checked':
				return t().filterOpChecked;
			default:
				return t().filterOpUnchecked;
		}
	}

	private filterableFields(): readonly Field[] {
		return this.config.fields.filter((field) => isFilterable(field));
	}

	private addCondition(): void {
		const first = this.filterableFields()[0];
		if (!first) {
			return;
		}
		// Repeats are allowed for the same reason as in the sort panel: they are
		// harmless, and refusing them makes the button look broken.
		this.conditions = [
			...this.conditions,
			{ fieldId: first.id, operator: operatorsFor(first)[0] ?? 'is', value: '' },
		];
		this.emit();
		this.render();
	}

	private emit(): void {
		this.config.onChange({
			conjunction: this.conjunction,
			conditions: this.conditions.map((condition) => ({ ...condition })),
		});
	}

	/** Keeps a condition pointing at a column that is still here. */
	override onClose(): void {
		super.onClose();
		const known = new Set(this.filterableFields().map((field) => field.id));
		const kept = this.conditions.filter((condition) => known.has(condition.fieldId));
		if (kept.length !== this.conditions.length) {
			this.config.onChange({
				conjunction: this.conjunction,
				conditions: kept.map((condition) => ({ ...condition })),
			});
		}
	}
}
