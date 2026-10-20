import { describe, expect, it } from 'vitest';
import { isSortable, sortRecords } from '../src/model/sort';
import type { CellValue, Field, LayerRecord, Sort } from '../src/types';

/** A record holding the given cells. */
function row(id: string, cells: Record<string, CellValue>): LayerRecord {
	return { id, created: '2026-01-01T00:00:00.000Z', cells };
}

const text: Field = { id: 'f_text', name: 'Text', type: 'text' };
const number: Field = { id: 'f_num', name: 'Num', type: 'number' };
const date: Field = { id: 'f_date', name: 'Date', type: 'date' };
const datetime: Field = { id: 'f_at', name: 'At', type: 'datetime' };
const box: Field = { id: 'f_box', name: 'Box', type: 'checkbox' };
const serial: Field = { id: 'f_no', name: 'No', type: 'autoNumber', numberLength: 2 };

/** The ids in the order they came out, which is what the assertions care about. */
function orderOf(
	rows: readonly LayerRecord[],
	fields: readonly Field[],
	sorts: readonly Sort[],
): string[] {
	return sortRecords(rows, fields, sorts).map((record) => record.id);
}

describe('ordering by a column', () => {
	it('sorts numbers as numbers, not as the text they show', () => {
		const rows = [
			row('a', { f_num: 10 }),
			row('b', { f_num: 9 }),
			row('c', { f_num: 100 }),
		];
		expect(orderOf(rows, [number], [{ fieldId: 'f_num', order: 'asc' }])).toEqual([
			'b',
			'a',
			'c',
		]);
	});

	it('sorts text the way a reader reads it, digits included', () => {
		// `item 2` before `item 10`: plain text order would put 10 first.
		const rows = [
			row('a', { f_text: 'item 10' }),
			row('b', { f_text: 'item 2' }),
		];
		expect(orderOf(rows, [text], [{ fieldId: 'f_text', order: 'asc' }])).toEqual([
			'b',
			'a',
		]);
	});

	it('sorts dates by the day they name', () => {
		const rows = [
			row('a', { f_date: '2026-12-01' }),
			row('b', { f_date: '2026-03-07' }),
		];
		expect(orderOf(rows, [date], [{ fieldId: 'f_date', order: 'asc' }])).toEqual([
			'b',
			'a',
		]);
	});

	it('sorts a date and a date-time in the same column together', () => {
		const rows = [
			row('a', { f_at: '2026-10-18T23:00' }),
			row('b', { f_at: '2026-10-18' }),
		];
		// Same day: the date-only value carries no time to push it later.
		expect(orderOf(rows, [datetime], [{ fieldId: 'f_at', order: 'asc' }])).toEqual([
			'b',
			'a',
		]);
	});

	it('puts unticked rows before ticked ones', () => {
		const rows = [row('a', { f_box: true }), row('b', { f_box: false })];
		expect(orderOf(rows, [box], [{ fieldId: 'f_box', order: 'asc' }])).toEqual([
			'b',
			'a',
		]);
	});

	it('sorts an auto number by its number, not its padded text', () => {
		const rows = [
			row('a', { f_no: 10 }),
			row('b', { f_no: 9 }),
		];
		expect(orderOf(rows, [serial], [{ fieldId: 'f_no', order: 'asc' }])).toEqual([
			'b',
			'a',
		]);
	});

	it('reverses for descending', () => {
		const rows = [row('a', { f_num: 1 }), row('b', { f_num: 2 })];
		expect(orderOf(rows, [number], [{ fieldId: 'f_num', order: 'desc' }])).toEqual([
			'b',
			'a',
		]);
	});
});

describe('empty cells', () => {
	it('sort below every value, whichever way the column runs', () => {
		/*
		 * An empty cell is an absence, not a small value. Putting it last on a
		 * descending sort would be the surprising thing: it would read as the
		 * largest number in the column.
		 */
		const rows = [
			row('a', { f_num: 5 }),
			row('empty', {}),
			row('c', { f_num: 1 }),
		];
		expect(orderOf(rows, [number], [{ fieldId: 'f_num', order: 'asc' }])).toEqual([
			'empty',
			'c',
			'a',
		]);
		expect(orderOf(rows, [number], [{ fieldId: 'f_num', order: 'desc' }])).toEqual([
			'a',
			'c',
			'empty',
		]);
	});
});

describe('the order that comes out', () => {
	it('leaves the rows alone when nothing is sorted', () => {
		const rows = [row('a', {}), row('b', {})];
		expect(orderOf(rows, [number], [])).toEqual(['a', 'b']);
	});

	it('does not reorder the array it was given', () => {
		// The document keeps the order rows were entered in; sorting is a view.
		const rows = [row('a', { f_num: 2 }), row('b', { f_num: 1 })];
		sortRecords(rows, [number], [{ fieldId: 'f_num', order: 'asc' }]);
		expect(rows.map((record) => record.id)).toEqual(['a', 'b']);
	});

	it('skips a rule naming a column that no longer exists', () => {
		const rows = [row('a', { f_num: 2 }), row('b', { f_num: 1 })];
		expect(orderOf(rows, [number], [{ fieldId: 'gone', order: 'asc' }])).toEqual([
			'a',
			'b',
		]);
	});

	it('uses the second rule when the first is equal', () => {
		const rows = [
			row('a', { f_text: 'same', f_num: 2 }),
			row('b', { f_text: 'same', f_num: 1 }),
		];
		expect(
			orderOf(rows, [text, number], [
				{ fieldId: 'f_text', order: 'asc' },
				{ fieldId: 'f_num', order: 'asc' },
			]),
		).toEqual(['b', 'a']);
	});
});

describe('which columns may be sorted', () => {
	it('refuses the ones the model cannot read', () => {
		// A computed column sorts by what the view works out, which this layer cannot
		// see, so offering it would sort a column of blanks.
		expect(isSortable({ id: 'x', name: 'X', type: 'formula' })).toBe(false);
		expect(isSortable({ id: 'x', name: 'X', type: 'rollup' })).toBe(false);
		expect(isSortable({ id: 'x', name: 'X', type: 'relationBack' })).toBe(false);
	});

	it('allows the ones it can read', () => {
		expect(isSortable(text)).toBe(true);
		expect(isSortable(serial)).toBe(true);
	});
});

describe('several rules at once', () => {
	/*
	 * A rule only decides rows the rules above it left tied. That is the whole
	 * point of listing them, and it is the part that cannot be checked on screen
	 * without building a table by hand.
	 */
	const rows = [
		row('a', { f_text: 'B', f_num: 1 }),
		row('b', { f_text: 'A', f_num: 2 }),
		row('c', { f_text: 'A', f_num: 1 }),
		row('d', { f_text: 'B', f_num: 2 }),
	];

	it('breaks a tie with the next rule', () => {
		expect(
			orderOf(rows, [text, number], [
				{ fieldId: 'f_text', order: 'asc' },
				{ fieldId: 'f_num', order: 'asc' },
			]),
		).toEqual(['c', 'b', 'a', 'd']);
	});

	it('honours the direction of each rule separately', () => {
		// Text ascending, then number descending within each group.
		expect(
			orderOf(rows, [text, number], [
				{ fieldId: 'f_text', order: 'asc' },
				{ fieldId: 'f_num', order: 'desc' },
			]),
		).toEqual(['b', 'c', 'd', 'a']);
	});

	it('changes nothing when the first rule already decides everything', () => {
		const distinct = [
			row('a', { f_text: 'A', f_num: 2 }),
			row('b', { f_text: 'B', f_num: 1 }),
		];
		expect(
			orderOf(distinct, [text, number], [
				{ fieldId: 'f_text', order: 'asc' },
				{ fieldId: 'f_num', order: 'asc' },
			]),
		).toEqual(['a', 'b']);
	});

	it('ignores a later rule naming a column that is gone', () => {
		expect(
			orderOf(rows, [text], [
				{ fieldId: 'f_text', order: 'asc' },
				{ fieldId: 'gone', order: 'desc' },
			]),
		).toEqual(['b', 'c', 'a', 'd']);
	});
});
describe('the same column listed twice', () => {
	/*
	 * Harmless by construction: a repeated rule can only decide rows the earlier
	 * one left tied, which by definition it cannot. Allowed because refusing it
	 * would mean the add button sometimes does nothing unexplained.
	 */
	it('changes nothing compared with one rule', () => {
		const rows = [
			row('a', { f_num: 2 }),
			row('b', { f_num: 1 }),
			row('c', { f_num: 3 }),
		];
		expect(
			orderOf(rows, [number], [
				{ fieldId: 'f_num', order: 'asc' },
				{ fieldId: 'f_num', order: 'asc' },
			]),
		).toEqual(['b', 'a', 'c']);
	});

	it('does not fight itself when the second repeat disagrees', () => {
		// The first rule settles every comparison, so the opposing one never runs.
		const rows = [
			row('a', { f_num: 2 }),
			row('b', { f_num: 1 }),
		];
		expect(
			orderOf(rows, [number], [
				{ fieldId: 'f_num', order: 'asc' },
				{ fieldId: 'f_num', order: 'desc' },
			]),
		).toEqual(['b', 'a']);
	});
});
describe('a value that changes where its row belongs', () => {
	/*
	 * The defect this exists for: after a table was sorted, editing a value left the
	 * rows where they were. The grid repaints the one cell it changed, so the new
	 * value appeared in the old position.
	 */
	it('moves the row when the sorted column is edited', () => {
		const rows = [
			row('a', { f_num: 1 }),
			row('b', { f_num: 2 }),
			row('c', { f_num: 3 }),
		];
		const sorts = [{ fieldId: 'f_num', order: 'asc' as const }];
		expect(orderOf(rows, [number], sorts)).toEqual(['a', 'b', 'c']);

		// The last row is given the smallest value, so it now belongs first.
		rows[2]!.cells.f_num = 0;
		expect(orderOf(rows, [number], sorts)).toEqual(['c', 'a', 'b']);
	});

	it('sorts an edited value the same way a fresh render would', () => {
		// Sorting is worked out from the records every time, so there is no cached
		// order to fall out of step with the values.
		const rows = [row('a', { f_text: 'pear' }), row('b', { f_text: 'apple' })];
		const sorts = [{ fieldId: 'f_text', order: 'asc' as const }];
		const before = orderOf(rows, [text], sorts);
		rows[1]!.cells.f_text = 'zebra';
		expect(orderOf(rows, [text], sorts)).not.toEqual(before);
	});
});