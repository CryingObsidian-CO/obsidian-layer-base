import { t } from '../i18n';
import { needsValue, operatorsFor } from '../model/filter';
import { shownNumber, storedNumber } from '../model/number';
import type { Field, FilterCondition, FilterOperator } from '../types';

/** What one operator is called in the reader's language. */
export function operatorLabel(operator: FilterOperator): string {
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

export interface ConditionRowOptions {
	/** The columns that may be named, in the order the table shows them. */
	fields: readonly Field[];
	/** Edited in place; the caller owns the copy it passed in. */
	condition: FilterCondition;
	/**
	 * Called after an edit. `redraw` says the row changed shape — a new column
	 * brings new operators with it, and an operator may want a value where the
	 * previous one did not. A caller must not redraw while the reader is typing,
	 * or the caret is lost mid-word, which is why typing reports false.
	 */
	onChange: (redraw: boolean) => void;
}

/**
 * Draws the three controls of one condition into `row`: this column, this
 * comparison, this value.
 *
 * Shared by the filter panel and the colour rules because they ask the same
 * question of the same columns — and a colour rule that offered a different set
 * of comparisons than the filter would be a second, quietly diverging opinion.
 */
export function renderConditionRow(
	row: HTMLElement,
	options: ConditionRowOptions,
): void {
	const { fields, condition, onChange } = options;

	const fieldSelect = row.createEl('select', { cls: 'layer-condition-field' });
	for (const candidate of fields) {
		const option = fieldSelect.createEl('option', { text: candidate.name });
		option.value = candidate.id;
	}
	fieldSelect.value = condition.fieldId;
	fieldSelect.addEventListener('change', () => {
		condition.fieldId = fieldSelect.value;
		// The operators belong to the column, so a new column starts over.
		const next = fields.find((candidate) => candidate.id === fieldSelect.value);
		const allowed = next ? operatorsFor(next) : [];
		condition.operator = allowed[0] ?? 'is';
		delete condition.value;
		onChange(true);
	});

	const field = fields.find((candidate) => candidate.id === condition.fieldId);
	const operatorSelect = row.createEl('select', {
		cls: 'layer-condition-operator',
	});
	const allowed = field ? operatorsFor(field) : [];
	for (const operator of allowed) {
		const option = operatorSelect.createEl('option', {
			text: operatorLabel(operator),
		});
		option.value = operator;
	}
	operatorSelect.value = allowed.includes(condition.operator)
		? condition.operator
		: allowed[0] ?? 'is';
	operatorSelect.addEventListener('change', () => {
		condition.operator = operatorSelect.value as FilterOperator;
		onChange(true);
	});

	// A value is only asked for when the operator needs one.
	if (field && needsValue(condition.operator)) {
		renderValue(row, field, condition, onChange);
	}
}

/** The value input, shaped for what the column holds. */
function renderValue(
	row: HTMLElement,
	field: Field,
	condition: FilterCondition,
	onChange: (redraw: boolean) => void,
): void {
	if (field.type === 'select' || field.type === 'multiSelect') {
		// A choice is picked from the names the cell shows, not typed from memory.
		const select = row.createEl('select', { cls: 'layer-condition-value' });
		const any = select.createEl('option', { text: t().filterAnyValue });
		any.value = '';
		for (const option of field.options ?? []) {
			const entry = select.createEl('option', { text: option.name });
			entry.value = option.name;
		}
		select.value = condition.value === undefined ? '' : String(condition.value);
		select.addEventListener('change', () => {
			condition.value = select.value;
			onChange(false);
		});
		return;
	}

	const input = row.createEl('input', { cls: 'layer-condition-value' });
	if (field.type === 'date' || field.type === 'datetime') {
		input.type = 'date';
	} else if (field.type === 'number' || field.type === 'autoNumber') {
		input.type = 'number';
	} else {
		input.type = 'text';
	}
	if (field.type === 'relation') {
		// The names a relation shows live in another table, which this panel cannot
		// read, so the placeholder says what is expected rather than offering a list
		// it would have to guess at.
		input.placeholder = t().filterRelationPlaceholder;
	}
	/*
	 * A number condition counts in the units the cells show: a percent column's
	 * cells read "15%", so the box beside them takes 15 rather than 0.15, and the
	 * comparison is made on the number the cell stores.
	 */
	const counts = field.type === 'number' || field.type === 'autoNumber';
	const shown =
		counts && typeof condition.value === 'number'
			? shownNumber(condition.value, field.numberFormat)
			: condition.value;
	input.value = condition.value === undefined ? '' : String(shown);
	input.addEventListener('input', () => {
		condition.value = counts
			? // A cleared box names no number: storing the zero an empty input reads as
				// would turn "no value yet" into a filter on 0.
				input.value.trim() === ''
				? ''
				: storedNumber(Number(input.value), field.numberFormat)
			: input.value;
		onChange(false);
	});
}
