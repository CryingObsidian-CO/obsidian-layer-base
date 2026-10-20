import type { CellValue, Field, LayerRecord, Sort, SortOrder } from '../types';
import { formatCell, isDerived } from './fields';

/**
 * Ordering rows by one or more columns.
 *
 * Kept free of the document and of `obsidian` so the comparison rules can be
 * tested directly: an order that is wrong for one type is the sort of defect
 * nobody notices until a list is long.
 */

/** The text a record holds in a field, as the reader would see it. */
function textOf(field: Field, record: LayerRecord): string {
	return formatCell(field, record.cells[field.id] ?? '');
}

/** The number a cell stands for, or null when it does not stand for one. */
function numberOrNull(field: Field, record: LayerRecord): number | null {
	const value: CellValue = record.cells[field.id] ?? '';
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}
	const text = textOf(field, record).trim().replace(/%$/, '');
	if (text === '') {
		return null;
	}
	const parsed = Number(text);
	return Number.isFinite(parsed) ? parsed : null;
}

/**
 * A date or date-time as a comparable number, or null.
 *
 * The time of day is kept so two values on the same day still order sensibly; a
 * date-only value counts as the start of that day.
 */
function dayOrNull(field: Field, record: LayerRecord): number | null {
	const text = textOf(field, record).trim();
	if (text === '') {
		return null;
	}
	const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2}))?/.exec(text);
	if (!match) {
		return null;
	}
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const hours = match[4] === undefined ? 0 : Number(match[4]);
	const minutes = match[5] === undefined ? 0 : Number(match[5]);
	if (
		!Number.isFinite(year) ||
		!Number.isFinite(month) ||
		!Number.isFinite(day) ||
		!Number.isFinite(hours) ||
		!Number.isFinite(minutes)
	) {
		return null;
	}
	return (((year * 10000 + month * 100 + day) * 24 + hours) * 60) + minutes;
}

/** How one record compares to another under one column's rule. */
function compareOne(field: Field, a: LayerRecord, b: LayerRecord): number {
	if (field.type === 'number' || field.type === 'autoNumber') {
		const left = numberOrNull(field, a);
		const right = numberOrNull(field, b);
		// An empty cell sorts below every number, whichever way the column is
		// ordered: "nothing" is not a small value, it is an absence.
		if (left === null && right === null) {
			return 0;
		}
		if (left === null) {
			return -1;
		}
		if (right === null) {
			return 1;
		}
		return left - right;
	}

	if (field.type === 'date' || field.type === 'datetime') {
		const left = dayOrNull(field, a);
		const right = dayOrNull(field, b);
		if (left === null && right === null) {
			return 0;
		}
		if (left === null) {
			return -1;
		}
		if (right === null) {
			return 1;
		}
		return left - right;
	}

	if (field.type === 'checkbox') {
		const left = a.cells[field.id] === true ? 1 : 0;
		const right = b.cells[field.id] === true ? 1 : 0;
		return left - right;
	}

	// Everything else compares as the text it shows, which is also what a reader
	// would do by eye. `localeCompare` with a numeric option keeps `item 2` before
	// `item 10` instead of after it.
	return textOf(field, a).localeCompare(textOf(field, b), undefined, {
		numeric: true,
		sensitivity: 'base',
	});
}

/**
 * The records in the order the view asks for.
 *
 * Rows are not moved in the document: the order is worked out for display, so two
 * views can sort the same table differently and the file keeps the order the rows
 * were entered in. A sort naming a column that no longer exists is skipped rather
 * than clearing the whole order.
 */
export function sortRecords(
	records: readonly LayerRecord[],
	fields: readonly Field[],
	sorts: readonly Sort[],
): readonly LayerRecord[] {
	const rules = sorts
		.map((sort) => ({ sort, field: fields.find((f) => f.id === sort.fieldId) }))
		.filter((rule): rule is { sort: Sort; field: Field } => rule.field !== undefined);

	if (rules.length === 0) {
		return records;
	}

	const ordered = records.slice();
	ordered.sort((a, b) => {
		for (const { sort, field } of rules) {
			const order: SortOrder = sort.order;
			const result = compareOne(field, a, b);
			if (result !== 0) {
				return order === 'desc' ? -result : result;
			}
		}
		return 0;
	});
	return ordered;
}

/** Whether a column can be sorted at all. */
export function isSortable(field: Field): boolean {
	// A derived column sorts by what it shows, which the view computes; the model
	// cannot see it, so offering the column would sort a column of blanks.
	return !isDerived(field.type);
}
