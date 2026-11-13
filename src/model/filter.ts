import type {
	CellValue,
	Field,
	Filter,
	FilterCondition,
	FilterOperator,
	LayerRecord,
} from '../types';
import { capabilityOf } from './capabilities';
import { dateMinutes, dayNumber, normaliseDateTime } from './date';
import { formatCell } from './fields';
import { parseShownNumber } from './number';

/** Free of the document and of `obsidian`, so each operator can be tested on its own. */

/**
 * A relation's names live in another table, so the caller supplies them: what is filtered
 * on is what the grid shows, not the row ids underneath.
 */
function textOf(
	field: Field,
	record: LayerRecord,
	cellText?: CellTextResolver,
): string {
	return cellText?.(field, record) ?? formatCell(field, record.cells[field.id] ?? '');
}

/** `null` means "not mine to answer": the plain rules take over. */
export type CellTextResolver = (field: Field, record: LayerRecord) => string | null;

export type RelationTextResolver = (
	field: Field,
	value: CellValue,
) => readonly string[];

function namesOf(
	field: Field,
	record: LayerRecord,
	resolve: RelationTextResolver | undefined,
): readonly string[] {
	const value = record.cells[field.id] ?? '';
	if (resolve === undefined) {
		// No resolver, no names: comparing ids would never match what a reader typed.
		return [];
	}
	return resolve(field, value);
}

function numberOf(
	field: Field,
	record: LayerRecord,
	cellText?: CellTextResolver,
): number | null {
	const raw: CellValue = record.cells[field.id] ?? '';
	if (typeof raw === 'number') {
		return Number.isFinite(raw) ? raw : null;
	}
	// Read the way the cell means it, so "42%" compares against 0.42.
	const text = textOf(field, record, cellText).trim();
	if (text === '') {
		return null;
	}
	return parseShownNumber(text);
}

/**
 * A date is compared by its day; a date-time keeps the time of day, or "later than
 * 1 February" would be false for everything that happened that day.
 */
function momentOf(
	field: Field,
	record: LayerRecord,
	cellText?: CellTextResolver,
): number | null {
	const text = textOf(field, record, cellText).trim();
	return field.type === 'datetime' ? dateMinutes(text) : dayNumber(text);
}

function emptyIn(
	field: Field,
	record: LayerRecord,
	cellText?: CellTextResolver,
): boolean {
	const raw = record.cells[field.id] ?? '';
	if (Array.isArray(raw)) {
		return raw.length === 0;
	}
	if (field.type === 'checkbox') {
		return raw !== true;
	}
	return textOf(field, record, cellText).trim() === '';
}

function wantedText(condition: FilterCondition): string {
	const value = condition.value;
	if (value === undefined || value === null) {
		return '';
	}
	return String(value);
}

/**
 * By what the value means, not how it is written: a date-time cell reads "2026-02-01 09:00"
 * while its picker holds "2026-02-01". `null` means nothing comparable was named (an empty box,
 * a word where a number belongs), and both `is` and `isNot` then keep no rows.
 */
function sameAsWanted(
	field: Field,
	record: LayerRecord,
	wanted: string,
	cellText?: CellTextResolver,
): boolean | null {
	if (field.type === 'number' || field.type === 'autoNumber') {
		const right = wanted.trim() === '' ? Number.NaN : Number(wanted);
		if (!Number.isFinite(right)) {
			return null;
		}
		return numberOf(field, record, cellText) === right;
	}
	if (field.type === 'date' || field.type === 'datetime') {
		const picked = momentOf(field, { id: '', created: '', cells: { [field.id]: wanted } });
		if (picked === null) {
			return null;
		}
		const cell = momentOf(field, record, cellText);
		if (cell === null) {
			// The cell holds nothing this column can read, so it is not that day.
			return false;
		}
		// A picker supplies a day and no time, so a day is compared as a day: a date-time's
		// day is where its minutes fall. A condition with a time asks about that minute.
		if (field.type === 'date') {
			return cell === picked;
		}
		return normaliseDateTime(wanted) === null
			? Math.floor(cell / 1440) === Math.floor(picked / 1440)
			: cell === picked;
	}
	return (
		textOf(field, record, cellText).trim().toLowerCase() === wanted.trim().toLowerCase()
	);
}

export function matchesCondition(
	field: Field,
	record: LayerRecord,
	condition: FilterCondition,
	resolve?: RelationTextResolver,
	cellText?: CellTextResolver,
): boolean {
	const operator: FilterOperator = condition.operator;
	const wanted = wantedText(condition);

	if (operator === 'isEmpty') {
		return emptyIn(field, record, cellText);
	}
	if (operator === 'isNotEmpty') {
		return !emptyIn(field, record, cellText);
	}
	if (operator === 'checked') {
		return record.cells[field.id] === true;
	}
	if (operator === 'unchecked') {
		return record.cells[field.id] !== true;
	}

	// One name at a time, not a joined string: a cell pointing at "Ann" and "Bob" has to
	// answer both "is Ann" and "contains An".
	if (field.type === 'relation') {
		const names = namesOf(field, record, resolve);
		const needle = wanted.trim().toLowerCase();
		const matchesOne = (name: string): boolean =>
			name.trim().toLowerCase() === needle;
		if (operator === 'is') {
			// Exactly this one: "is Ann" on a row linked to Ann and Bob is not about Ann alone.
			return names.length === 1 && matchesOne(names[0] as string);
		}
		if (operator === 'isNot') {
			return !(names.length === 1 && matchesOne(names[0] as string));
		}
		if (operator === 'contains') {
			// Any of the names it points at.
			return names.some(matchesOne);
		}
		if (operator === 'notContains') {
			return !names.some(matchesOne);
		}
		return false;
	}

	const shown = textOf(field, record, cellText);

	if (operator === 'is' || operator === 'isNot') {
		const same = sameAsWanted(field, record, wanted, cellText);
		if (same === null) {
			return false;
		}
		return operator === 'is' ? same : !same;
	}
	if (operator === 'contains') {
		return shown.toLowerCase().includes(wanted.toLowerCase());
	}
	if (operator === 'notContains') {
		return !shown.toLowerCase().includes(wanted.toLowerCase());
	}

	// The ordered comparisons need an order, which dates and numbers have and text does not.
	if (field.type === 'date' || field.type === 'datetime') {
		const left = momentOf(field, record, cellText);
		const right = momentOf(field, { id: '', created: '', cells: { [field.id]: wanted } });
		if (left === null || right === null) {
			return false;
		}
		return compareBy(operator, left, right);
	}

	const left = numberOf(field, record, cellText);
	// A blank box names no number; comparing against zero would be a condition nobody wrote.
	const right = wanted.trim() === '' ? Number.NaN : Number(wanted);
	if (left === null || !Number.isFinite(right)) {
		return false;
	}
	return compareBy(operator, left, right);
}

function compareBy(operator: FilterOperator, left: number, right: number): boolean {
	if (operator === 'greaterThan') {
		return left > right;
	}
	if (operator === 'lessThan') {
		return left < right;
	}
	return false;
}

/**
 * An empty filter keeps everything, and a condition naming a column that is gone is
 * skipped: a deleted column should not empty the table.
 */
export function filterRecords(
	records: readonly LayerRecord[],
	fields: readonly Field[],
	filter: Filter | undefined,
	resolve?: RelationTextResolver,
	cellText?: CellTextResolver,
): readonly LayerRecord[] {
	if (!filter || filter.conditions.length === 0) {
		return records;
	}

	const usable = filter.conditions.filter((condition) =>
		fields.some((field) => field.id === condition.fieldId),
	);
	if (usable.length === 0) {
		return records;
	}

	return records.filter((record) => {
		const results = usable.map((condition) => {
			const field = fields.find((candidate) => candidate.id === condition.fieldId);
			return field ? matchesCondition(field, record, condition, resolve, cellText) : true;
		});
		return filter.conjunction === 'or'
			? results.some(Boolean)
			: results.every(Boolean);
	});
}

export function operatorsFor(field: Field): readonly FilterOperator[] {
	return capabilityOf(field.type).filters;
}

export function needsValue(operator: FilterOperator): boolean {
	return (
		operator !== 'isEmpty' &&
		operator !== 'isNotEmpty' &&
		operator !== 'checked' &&
		operator !== 'unchecked'
	);
}
