import type { CellValue, Field, LayerRecord, Sort, SortOrder } from '../types';
import { formatCell } from './fields';

/**
 * Ordering rows by one or more columns.
 *
 * Kept free of the document and of `obsidian` so the comparison rules can be
 * tested directly: an order that is wrong for one type is the sort of defect
 * nobody notices until a list is long.
 */

/** The text a record holds in a field, as the reader would see it. */
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

/** The number a cell stands for, or null when it does not stand for one. */
function numberOrNull(
	field: Field,
	record: LayerRecord,
	cellText?: CellTextResolver,
): number | null {
	const value: CellValue = record.cells[field.id] ?? '';
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}
	const text = textOf(field, record, cellText).trim().replace(/%$/, '');
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
function dayOrNull(
	field: Field,
	record: LayerRecord,
	cellText?: CellTextResolver,
): number | null {
	const text = textOf(field, record, cellText).trim();
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

/**
 * The number a piece of text is, or null when it is text and nothing else.
 *
 * Strict on purpose: `Number()` also reads `0x10`, `1e5` and `Infinity`, and a text
 * column holding one of those is text, not a quantity.
 */
function plainNumber(text: string): number | null {
	const trimmed = text.trim().replace(/%$/, '').trim();
	if (!/^[-+]?(\d+(\.\d+)?|\.\d+)$/.test(trimmed)) {
		return null;
	}
	const value = Number(trimmed);
	return Number.isFinite(value) ? value : null;
}

/** How one record compares to another under one column's rule. */
function compareOne(
	field: Field,
	a: LayerRecord,
	b: LayerRecord,
	cellText?: CellTextResolver,
): number {
	if (field.type === 'number' || field.type === 'autoNumber') {
		const left = numberOrNull(field, a, cellText);
		const right = numberOrNull(field, b, cellText);
		// "Nothing" is not a small value, it is an absence: it sorts as the smallest
		// thing there is, which puts it first ascending and last descending, because
		// the whole comparison is reversed for a descending column.
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
		const left = dayOrNull(field, a, cellText);
		const right = dayOrNull(field, b, cellText);
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

	/*
	 * Everything else compares as the text it shows, with one exception: when both
	 * cells read as plain numbers, they compare as numbers.
	 *
	 * A computed column — a lookup, a rollup, a formula — reaches this module only as
	 * text, and the collator gets decimals wrong: `1.5` came before `1.25`, because
	 * numeric collation compares digit runs and `5` is smaller than `25`. A text
	 * column that happens to hold numbers reads the same way to a reader's eye.
	 */
	const leftText = textOf(field, a, cellText);
	const rightText = textOf(field, b, cellText);
	const left = plainNumber(leftText);
	const right = plainNumber(rightText);
	if (left !== null && right !== null) {
		return left - right;
	}
	return leftText.localeCompare(rightText, undefined, {
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
	cellText?: CellTextResolver,
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
			const result = compareOne(field, a, b, cellText);
			if (result !== 0) {
				return order === 'desc' ? -result : result;
			}
		}
		return 0;
	});
	return ordered;
}
