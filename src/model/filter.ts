import type {
	CellValue,
	Field,
	Filter,
	FilterCondition,
	FilterOperator,
	LayerRecord,
} from '../types';
import { formatCell } from './fields';

/**
 * Deciding which rows a view keeps.
 *
 * Free of the document and of `obsidian` so each operator can be tested on its
 * own: a filter that is wrong for one type hides rows silently, which is worse
 * than showing them.
 */

/**
 * The text a cell reads as, which is what most operators compare.
 *
 * A relation is the exception, and it cannot be resolved here: its names live in
 * another table this layer cannot see. The caller supplies them through
 * `relationTexts`, so what is filtered on is what the grid shows rather than the
 * row ids it stores underneath.
 */
function textOf(
	field: Field,
	record: LayerRecord,
	cellText?: CellTextResolver,
): string {
	return cellText?.(field, record) ?? formatCell(field, record.cells[field.id] ?? '');
}

/**
 * How the caller resolves a cell's text for a type this layer cannot read itself.
 *
 * `null` means "not mine to answer", and the plain rules take over — so a caller that
 * knows nothing about these types changes nothing by leaving it out.
 */
export type CellTextResolver = (field: Field, record: LayerRecord) => string | null;

/** How the caller resolves the row names a relation cell points at. */
export type RelationTextResolver = (
	field: Field,
	value: CellValue,
) => readonly string[];

/** The names a relation cell shows, in the order the cell lists them. */
function namesOf(
	field: Field,
	record: LayerRecord,
	resolve: RelationTextResolver | undefined,
): readonly string[] {
	const value = record.cells[field.id] ?? '';
	if (resolve === undefined) {
		// Without a resolver there are no names to compare, so an unresolvable
		// relation compares as nothing rather than as its ids — an id would never
		// match anything a reader typed.
		return [];
	}
	return resolve(field, value);
}

/** The number a cell stands for, or null when it does not stand for one. */
function numberOf(
	field: Field,
	record: LayerRecord,
	cellText?: CellTextResolver,
): number | null {
	const raw: CellValue = record.cells[field.id] ?? '';
	if (typeof raw === 'number') {
		return Number.isFinite(raw) ? raw : null;
	}
	const text = textOf(field, record, cellText).trim().replace(/%$/, '');
	if (text === '') {
		return null;
	}
	const parsed = Number(text);
	return Number.isFinite(parsed) ? parsed : null;
}

/** A day count for a date or date-time cell, or null. */
function dayOf(
	field: Field,
	record: LayerRecord,
	cellText?: CellTextResolver,
): number | null {
	const text = textOf(field, record, cellText).trim();
	const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
	if (!match) {
		return null;
	}
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
		return null;
	}
	return year * 10000 + month * 100 + day;
}

/** Whether the cell holds nothing, by the same rule the grid draws with. */
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

/** The value a condition compares against, as text. */
function wantedText(condition: FilterCondition): string {
	const value = condition.value;
	if (value === undefined || value === null) {
		return '';
	}
	return String(value);
}

/**
 * Whether one row passes one condition.
 *
 * Operators are matched to what the column can actually answer: a number column is
 * compared as a number whatever the reader typed, and a choice column compares the
 * names it shows rather than the ids it stores, so what is filtered on is what is
 * seen.
 */
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

	/*
	 * A relation is compared one name at a time, not as a joined string: a cell
	 * pointing at "Ann" and "Bob" has to answer "is Ann" as well as "contains An",
	 * and a joined string would only ever match a substring of the whole list.
	 */
	if (field.type === 'relation') {
		const names = namesOf(field, record, resolve);
		const needle = wanted.trim().toLowerCase();
		const matchesOne = (name: string): boolean =>
			name.trim().toLowerCase() === needle;
		if (operator === 'is') {
			// Exactly this row and nothing else: "is Ann" on a row linked to both Ann
			// and Bob is not a row about Ann alone.
			return names.length === 1 && matchesOne(names[0] as string);
		}
		if (operator === 'isNot') {
			return !(names.length === 1 && matchesOne(names[0] as string));
		}
		if (operator === 'contains') {
			// Any of the names it points at, which is what a reader means by "linked
			// to someone called Ann".
			return names.some(matchesOne);
		}
		if (operator === 'notContains') {
			return !names.some(matchesOne);
		}
		return false;
	}

	const shown = textOf(field, record, cellText);

	if (operator === 'is') {
		if (field.type === 'number' || field.type === 'autoNumber') {
			return numberOf(field, record, cellText) === Number(wanted);
		}
		return shown.trim().toLowerCase() === wanted.trim().toLowerCase();
	}
	if (operator === 'isNot') {
		if (field.type === 'number' || field.type === 'autoNumber') {
			return numberOf(field, record, cellText) !== Number(wanted);
		}
		return shown.trim().toLowerCase() !== wanted.trim().toLowerCase();
	}
	if (operator === 'contains') {
		return shown.toLowerCase().includes(wanted.toLowerCase());
	}
	if (operator === 'notContains') {
		return !shown.toLowerCase().includes(wanted.toLowerCase());
	}

	// The four comparisons need an order, which dates and numbers have and text
	// does not: comparing words by size says nothing a reader means.
	if (field.type === 'date' || field.type === 'datetime') {
		const left = dayOf(field, record, cellText);
		const right = dayOf(field, { id: '', created: '', cells: { [field.id]: wanted } });
		if (left === null || right === null) {
			return false;
		}
		return compareBy(operator, left, right);
	}

	const left = numberOf(field, record, cellText);
	const right = Number(wanted);
	if (left === null || Number.isNaN(right)) {
		return false;
	}
	return compareBy(operator, left, right);
}

/** Applies one of the four ordered operators. */
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
 * The rows a filter keeps.
 *
 * An empty filter keeps everything, and a condition naming a column that is gone
 * is skipped rather than hiding every row: a deleted column should not empty the
 * table.
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

/** The operators a column's type can answer. */
export function operatorsFor(field: Field): readonly FilterOperator[] {
	if (field.type === 'checkbox') {
		return ['checked', 'unchecked'];
	}
	if (field.type === 'date' || field.type === 'datetime') {
		return [
			'is',
			'isNot',
			'greaterThan',
			'lessThan',
			'isEmpty',
			'isNotEmpty',
		];
	}
	if (field.type === 'number' || field.type === 'autoNumber') {
		return [
			'is',
			'isNot',
			'greaterThan',
			'lessThan',
			'isEmpty',
			'isNotEmpty',
		];
	}
	return ['is', 'isNot', 'contains', 'notContains', 'isEmpty', 'isNotEmpty'];
}

/** Whether an operator needs a value typed in. */
export function needsValue(operator: FilterOperator): boolean {
	return (
		operator !== 'isEmpty' &&
		operator !== 'isNotEmpty' &&
		operator !== 'checked' &&
		operator !== 'unchecked'
	);
}
