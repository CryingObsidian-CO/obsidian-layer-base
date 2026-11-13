import { describe, expect, it } from 'vitest';
import { sortRecords } from '../src/model/sort';
import type { CellValue, Field, LayerRecord, Sort } from '../src/types';

function row(id: string, cells: Record<string, CellValue>): LayerRecord {
	return { id, created: '2026-01-01T00:00:00.000Z', cells };
}

const text: Field = { id: 'f_text', name: 'Text', type: 'text' };
const number: Field = { id: 'f_num', name: 'Num', type: 'number' };
const date: Field = { id: 'f_date', name: 'Date', type: 'date' };
const datetime: Field = { id: 'f_at', name: 'At', type: 'datetime' };
const box: Field = { id: 'f_box', name: 'Box', type: 'checkbox' };
const serial: Field = { id: 'f_no', name: 'No', type: 'autoNumber', numberLength: 2 };

function orderOf(
	rows: readonly LayerRecord[],
	fields: readonly Field[],
	sorts: readonly Sort[],
): string[] {
	return sortRecords(rows, fields, sorts).map((record) => record.id);
}

describe('ordering by a column', () => {
	it('orders a number against a word by a fixed rule, not by the collator', () => {
		const rows = [
			row('a', { f_text: '1.5a' }),
			row('b', { f_text: '1.5' }),
			row('c', { f_text: '1.25' }),
		];

		// Mixed number/word pairs must not reach the collator: `1.25 < 1.5 < 1.5a < 1.25` is a cycle.
		expect(orderOf(rows, [text], [{ fieldId: 'f_text', order: 'asc' }])).toEqual([
			'c',
			'b',
			'a',
		]);
	});

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
		expect(orderOf(rows, [datetime], [{ fieldId: 'f_at', order: 'asc' }])).toEqual([
			'b',
			'a',
		]);
	});

	it('puts a later day after an earlier one however the time is written', () => {
		const rows = [
			row('next', { f_at: '2026-10-19' }),
			row('late', { f_at: '2026-10-18T23:00' }),
		];
		expect(orderOf(rows, [datetime], [{ fieldId: 'f_at', order: 'asc' }])).toEqual([
			'late',
			'next',
		]);
	});

	it('keeps the minute of a value written with seconds', () => {
		// Seconds are not stored, but a value written with them is still a real moment.
		const rows = [
			row('sometime', { f_at: '2026-10-18T23:00:59' }),
			row('earlier', { f_at: '2026-10-18T22:00' }),
		];
		expect(orderOf(rows, [datetime], [{ fieldId: 'f_at', order: 'asc' }])).toEqual([
			'earlier',
			'sometime',
		]);
	});

	it('keeps a value it cannot read as a date with the empty ones', () => {
		// A hand-edited file can hold `2026-13-45`; the loader drops it, so it sorts with the empty cells.
		const rows = [
			row('bad', { f_at: '2026-13-45' }),
			row('real', { f_at: '2026-10-18' }),
		];
		expect(orderOf(rows, [datetime], [{ fieldId: 'f_at', order: 'asc' }])).toEqual([
			'bad',
			'real',
		]);
		expect(orderOf(rows, [datetime], [{ fieldId: 'f_at', order: 'desc' }])).toEqual([
			'real',
			'bad',
		]);
	});

	it('does not read a value carrying a time zone as local time', () => {
		// The format has no time zones: a value carrying one is unreadable, not midnight elsewhere.
		const rows = [
			row('zoned', { f_at: '2026-10-20T00:00+08:00' }),
			row('plain', { f_at: '2026-10-18' }),
		];
		expect(orderOf(rows, [datetime], [{ fieldId: 'f_at', order: 'asc' }])).toEqual([
			'zoned',
			'plain',
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
	it('sorts a computed column through the text handed in', () => {
		const computed: Field = { id: 'f_c', name: 'C', type: 'formula' };
		const rows = [row('r1', {}), row('r2', {})];
		const text = (record: LayerRecord): string =>
			record.id === 'r1' ? 'b' : 'a';
		const ordered = sortRecords(
			rows,
			[computed],
			[{ fieldId: 'f_c', order: 'asc' }],
			(field, record) => (field.id === 'f_c' ? text(record) : null),
		);
		expect(ordered.map((entry) => entry.id)).toEqual(['r2', 'r1']);
	});
});

describe('several rules at once', () => {
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
	// A repeated rule can never decide anything; refusing it would leave the add button doing nothing.
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
	it('moves the row when the sorted column is edited', () => {
		const rows = [
			row('a', { f_num: 1 }),
			row('b', { f_num: 2 }),
			row('c', { f_num: 3 }),
		];
		const sorts = [{ fieldId: 'f_num', order: 'asc' as const }];
		expect(orderOf(rows, [number], sorts)).toEqual(['a', 'b', 'c']);

		rows[2]!.cells.f_num = 0;
		expect(orderOf(rows, [number], sorts)).toEqual(['c', 'a', 'b']);
	});

	it('sorts an edited value the same way a fresh render would', () => {
		const rows = [row('a', { f_text: 'pear' }), row('b', { f_text: 'apple' })];
		const sorts = [{ fieldId: 'f_text', order: 'asc' as const }];
		const before = orderOf(rows, [text], sorts);
		rows[1]!.cells.f_text = 'zebra';
		expect(orderOf(rows, [text], sorts)).not.toEqual(before);
	});
});

describe('what one sort pass builds', () => {
	function countedSelect(): { field: Field; reads: () => number } {
		let reads = 0;
		const options = Array.from({ length: 4 }, (_unused, index) => ({
			id: `o_${index}`,
			name: `Option ${index}`,
			color: 'blue',
		}));
		const proxied = new Proxy(options, {
			get(target, property, receiver) {
				if (typeof property === 'string' && /^\d+$/.test(property)) {
					reads += 1;
				}
				const value: unknown = Reflect.get(target, property, receiver);
				return value;
			},
		});
		return {
			field: { id: 'f_sel', name: 'Choice', type: 'select', options: proxied },
			reads: () => reads,
		};
	}

	it('builds the option ranks once for the column, not once per comparison', () => {
		const { field, reads } = countedSelect();
		const rows = Array.from({ length: 40 }, (_unused, index) =>
			row(`r${index}`, { f_sel: `o_${index % 4}` }),
		);

		sortRecords(rows, [field], [{ fieldId: 'f_sel', order: 'asc' }]);

		expect(reads()).toBe(4);
	});

	it('reads a cell once per record, not once per comparison', () => {
		const rows = Array.from({ length: 40 }, (_unused, index) =>
			row(`r${index}`, { f_text: `value ${index}` }),
		);
		let calls = 0;

		sortRecords(
			rows,
			[text],
			[{ fieldId: 'f_text', order: 'asc' }],
			(_field, record) => {
				calls += 1;
				return `value ${String(record.cells.f_text ?? '')}`;
			},
		);

		expect(calls).toBe(rows.length);
	});
});