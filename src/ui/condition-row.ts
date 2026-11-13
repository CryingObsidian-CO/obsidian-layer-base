import { t } from '../i18n';
import { needsValue, operatorsFor } from '../model/filter';
import { shownNumber, storedNumber } from '../model/number';
import type { Field, FilterCondition, FilterOperator } from '../types';

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
	fields: readonly Field[];
	/** Edited in place; the caller owns the copy it passed in. */
	condition: FilterCondition;
	/**
	 * `redraw` says the row changed shape. Typing passes false: redrawing mid-word
	 * loses the caret.
	 */
	onChange: (redraw: boolean) => void;
}

/** Shared with the colour rules, so both offer the same operators for the same column. */
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
	// A saved operator the column cannot answer is replaced, not just hidden: the select
	// can only show what it has an option for, so a stale one leaves the panel lying.
	if (!allowed.includes(condition.operator)) {
		condition.operator = allowed[0] ?? 'is';
	}
	operatorSelect.value = condition.operator;
	operatorSelect.addEventListener('change', () => {
		condition.operator = operatorSelect.value as FilterOperator;
		onChange(true);
	});

	if (field && needsValue(condition.operator)) {
		renderValue(row, field, condition, onChange);
	}
}

function renderValue(
	row: HTMLElement,
	field: Field,
	condition: FilterCondition,
	onChange: (redraw: boolean) => void,
): void {
	if (field.type === 'select' || field.type === 'multiSelect') {
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
		// The names live in another table this panel cannot read, so there is nothing to list.
		input.placeholder = t().filterRelationPlaceholder;
	}
	// Counts in the units the cells show: a percent column reads "15%", so the box takes 15, stored 0.15.
	const counts = field.type === 'number' || field.type === 'autoNumber';
	const shown =
		counts && typeof condition.value === 'number'
			? shownNumber(condition.value, field.numberFormat)
			: condition.value;
	input.value = condition.value === undefined ? '' : String(shown);
	input.addEventListener('input', () => {
		if (!counts) {
			condition.value = input.value;
			onChange(false);
			return;
		}
		const raw = input.value.trim();
		// A cleared box names no number — storing the zero it reads as would turn "no value
		// yet" into a filter on 0 — and neither does an entry no one can read as one.
		const parsed = raw === '' ? Number.NaN : Number(raw);
		if (Number.isFinite(parsed)) {
			condition.value = storedNumber(parsed, field.numberFormat);
		} else {
			delete condition.value;
		}
		onChange(false);
	});
}
