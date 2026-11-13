import type { CellValue, Field, LayerRecord, Sort } from '../types';
import { dateMinutes } from './date';
import { formatCell, optionIds } from './fields';
import { optionRanks } from './select-options';

/** Free of the document and of `obsidian`, so the comparison rules can be tested directly. */

function textOf(
	field: Field,
	record: LayerRecord,
	cellText?: CellTextResolver,
): string {
	return cellText?.(field, record) ?? formatCell(field, record.cells[field.id] ?? '');
}

type TextOf = (record: LayerRecord) => string;

/**
 * Computed text is the whole cost of a comparison, and cannot change within one sort,
 * so each record is asked once instead of once per pair.
 */
function textGetter(field: Field, cellText?: CellTextResolver): TextOf {
	const seen = new Map<LayerRecord, string>();
	return (record) => {
		const cached = seen.get(record);
		if (cached !== undefined) {
			return cached;
		}
		const text = textOf(field, record, cellText);
		seen.set(record, text);
		return text;
	};
}

/** `null` means "not mine to answer": the plain rules take over. */
export type CellTextResolver = (field: Field, record: LayerRecord) => string | null;

function numberOrNull(
	field: Field,
	record: LayerRecord,
	text: TextOf,
): number | null {
	const value: CellValue = record.cells[field.id] ?? '';
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}
	const shown = text(record).trim().replace(/%$/, '');
	if (shown === '') {
		return null;
	}
	const parsed = Number(shown);
	return Number.isFinite(parsed) ? parsed : null;
}

/** Asked of the date module, so the sort calls a value a date on the same terms the editor and the loader do. */
function momentOrNull(shown: string): number | null {
	return dateMinutes(shown.trim());
}

/** Strict: `Number()` also reads `0x10`, `1e5` and `Infinity`, and a text column holding one is text. */
function plainNumber(text: string): number | null {
	const trimmed = text.trim().replace(/%$/, '').trim();
	if (!/^[-+]?(\d+(\.\d+)?|\.\d+)$/.test(trimmed)) {
		return null;
	}
	const value = Number(trimmed);
	return Number.isFinite(value) ? value : null;
}

/**
 * A multiple choice compares as its list of ranks, so `{A, C}` comes before `{B}` when A is
 * defined first. An id whose option is gone has a value but no place: it sorts after the rest.
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

function compareOne(
	field: Field,
	a: LayerRecord,
	b: LayerRecord,
	text: TextOf,
): number {
	if (field.type === 'number' || field.type === 'autoNumber') {
		const left = numberOrNull(field, a, text);
		const right = numberOrNull(field, b, text);
		// Nothing is an absence, not a small value: it sorts as the smallest thing, which is
		// first ascending and last descending once the comparison is reversed.
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
		const left = momentOrNull(text(a));
		const right = momentOrNull(text(b));
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

	// Two cells that read as plain numbers compare as numbers: numeric collation gets
	// decimals wrong (`1.5` before `1.25`). A number against a word is settled by a fixed
	// rule too, or the collator's digit runs make a cycle and `sort` returns any order.
	const leftText = text(a);
	const rightText = text(b);
	const left = plainNumber(leftText);
	const right = plainNumber(rightText);
	if (left !== null && right !== null) {
		return left - right;
	}
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

type Compare = (a: LayerRecord, b: LayerRecord) => number;

/** Everything that cannot change during one sort is built before the first comparison, which runs O(n log n) times. */
function prepareCompare(field: Field, cellText?: CellTextResolver): Compare {
	// Choice columns order by the option list, the one order such a field has: the board
	// draws its columns in it, so a table sorted this way agrees with the board.
	if (field.type === 'select' || field.type === 'multiSelect') {
		const ranks = optionRanks(field.options);
		return (a, b) =>
			compareRankLists(
				rankListOf(field, a, ranks),
				rankListOf(field, b, ranks),
			);
	}
	const text = textGetter(field, cellText);
	return (a, b) => compareOne(field, a, b, text);
}

/**
 * Rows are not moved in the document, so two views can sort the same table differently; a
 * sort naming a column that no longer exists is skipped rather than clearing the order.
 */
export function sortRecords(
	records: readonly LayerRecord[],
	fields: readonly Field[],
	sorts: readonly Sort[],
	cellText?: CellTextResolver,
): readonly LayerRecord[] {
	const rules: { sort: Sort; compare: Compare }[] = [];
	for (const sort of sorts) {
		const field = fields.find((candidate) => candidate.id === sort.fieldId);
		if (field !== undefined) {
			rules.push({ sort, compare: prepareCompare(field, cellText) });
		}
	}

	if (rules.length === 0) {
		return records;
	}

	const ordered = records.slice();
	ordered.sort((a, b) => {
		for (const { sort, compare } of rules) {
			const result = compare(a, b);
			if (result !== 0) {
				return sort.order === 'desc' ? -result : result;
			}
		}
		return 0;
	});
	return ordered;
}
