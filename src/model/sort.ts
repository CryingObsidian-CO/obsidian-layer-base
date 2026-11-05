import type { CellValue, Field, LayerRecord, Sort, SortOrder } from '../types';
import { dateMinutes } from './date';
import { formatCell, optionIds } from './fields';
import { optionRanks } from './select-options';

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
 * Asked of the date module rather than read here: sorting has to call a value a
 * date on exactly the terms the editor, the formula engine and the file loader
 * do, or the same cell is one thing to the column and another to the sort. A
 * time of day is kept so two values on the same day still order sensibly.
 */
function momentOrNull(
	field: Field,
	record: LayerRecord,
	cellText?: CellTextResolver,
): number | null {
	return dateMinutes(textOf(field, record, cellText).trim());
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

/**
 * Where a choice cell sits in its column's option order, or null when it holds
 * nothing.
 *
 * A select cell holds one option id. A multiple-choice cell holds several, and
 * those are shown in the option order too, so the comparison is between the rank
 * lists themselves: `{A, C}` comes before `{B}` when A is defined before B, and
 * `{A}` before `{A, C}` because the shorter list is a prefix of the longer one.
 *
 * A cell holding an id whose option is gone has a value but no place in the
 * order; it sorts after the options that still exist rather than passing for an
 * empty cell.
 */
function rankListOf(
	field: Field,
	record: LayerRecord,
	ranks: Map<string, number>,
): number[] | null {
	const value = record.cells[field.id] ?? '';
	if (field.type === 'select') {
		if (typeof value !== 'string' || value === '') {
			return null;
		}
		return [ranks.get(value) ?? Number.MAX_SAFE_INTEGER];
	}
	const ids = optionIds(value);
	if (ids.length === 0) {
		return null;
	}
	const known = ids
		.map((id) => ranks.get(id))
		.filter((rank): rank is number => rank !== undefined)
		.sort((left, right) => left - right);
	if (known.length === 0) {
		return [Number.MAX_SAFE_INTEGER];
	}
	if (known.length < ids.length) {
		known.push(Number.MAX_SAFE_INTEGER);
	}
	return known;
}

/** Two rank lists: an absent one first, a shorter prefix before its extension. */
function compareRankLists(
	left: number[] | null,
	right: number[] | null,
): number {
	if (left === null || right === null) {
		return left === right ? 0 : left === null ? -1 : 1;
	}
	const shared = Math.min(left.length, right.length);
	for (let index = 0; index < shared; index += 1) {
		const leftRank = left[index] ?? 0;
		const rightRank = right[index] ?? 0;
		if (leftRank !== rightRank) {
			return leftRank - rightRank;
		}
	}
	return left.length - right.length;
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
		const left = momentOrNull(field, a, cellText);
		const right = momentOrNull(field, b, cellText);
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
	 * Choice columns order by the options themselves, not by the words in the
	 * cells: the option list is the one order such a field has — the board draws
	 * its columns in it and the dropdown lists it in it — so a table sorted this
	 * way agrees with the board rather than arguing with it. Sorting these by
	 * name is what made the two disagree.
	 */
	if (field.type === 'select' || field.type === 'multiSelect') {
		const ranks = optionRanks(field.options);
		return compareRankLists(
			rankListOf(field, a, ranks),
			rankListOf(field, b, ranks),
		);
	}

	/*
	 * Everything else compares as the text it shows, with one exception: when both
	 * cells read as plain numbers, they compare as numbers.
	 *
	 * A computed column — a lookup, a rollup, a formula — reaches this module only as
	 * text, and the collator gets decimals wrong: `1.5` came before `1.25`, because
	 * numeric collation compares digit runs and `5` is smaller than `25`. A text
	 * column that happens to hold numbers reads the same way to a reader's eye.
	 *
	 * A cell holding a number is settled against a cell holding words by a fixed
	 * rule rather than by the collator. Left to the collator those pairs compared
	 * digit runs, which is not the same question as "is this a number", and three
	 * values were enough to make a cycle out of it: `1.25`, `1.5`, `1.5a` came out
	 * as `1.25 < 1.5`, `1.5 < 1.5a` and `1.5a < 1.25`. A comparator like that has no
	 * order to find, so `sort` returns whatever its algorithm happens to produce.
	 */
	const leftText = textOf(field, a, cellText);
	const rightText = textOf(field, b, cellText);
	const left = plainNumber(leftText);
	const right = plainNumber(rightText);
	if (left !== null && right !== null) {
		return left - right;
	}
	// Numbers first, words after: one fixed answer for every mixed pair, and it
	// agrees with the numeric order above rather than cutting across it.
	if (left !== null) {
		return -1;
	}
	if (right !== null) {
		return 1;
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
