import { describe, expect, it } from 'vitest';
import {
	filterRecords,
	needsValue,
	operatorsFor,
} from '../src/model/filter';
import type { CellValue, Field, FilterCondition, LayerRecord } from '../src/types';

function row(id: string, cells: Record<string, CellValue>): LayerRecord {
	return { id, created: '2026-01-01T00:00:00.000Z', cells };
}

const text: Field = { id: 'f_text', name: 'Text', type: 'text' };
const number: Field = { id: 'f_num', name: 'Num', type: 'number' };
const date: Field = { id: 'f_date', name: 'Date', type: 'date' };
const box: Field = { id: 'f_box', name: 'Box', type: 'checkbox' };
const select: Field = {
	id: 'f_sel',
	name: 'Sel',
	type: 'select',
	options: [
		{ id: 'o1', name: 'Done', color: 'blue' },
		{ id: 'o2', name: 'Todo', color: 'red' },
	],
};

const rows = [
	row('a', { f_text: 'apple', f_num: 1, f_date: '2026-01-10', f_box: true, f_sel: 'o1' }),
	row('b', { f_text: 'banana', f_num: 5, f_date: '2026-02-20', f_sel: 'o2' }),
	row('c', { f_text: 'cherry', f_num: 10, f_date: '2026-03-30', f_box: true }),
	row('d', { f_text: '', f_num: '', f_date: '' }),
];

/** The ids a filter keeps. */
function keep(
	fields: readonly Field[],
	conditions: Parameters<typeof filterRecords>[2] extends infer F
		? F extends { conditions: infer C }
			? C
			: never
		: never,
	conjunction: 'and' | 'or' = 'and',
): string[] {
	return filterRecords(rows, fields, { conjunction, conditions }).map((r) => r.id);
}

describe('the text operators', () => {
	it('matches exactly, ignoring case', () => {
		expect(
			keep([text], [{ fieldId: 'f_text', operator: 'is', value: 'APPLE' }]),
		).toEqual(['a']);
	});

	it('excludes what it does not match', () => {
		expect(
			keep([text], [{ fieldId: 'f_text', operator: 'isNot', value: 'apple' }]),
		).toEqual(['b', 'c', 'd']);
	});

	it('looks inside the text', () => {
		expect(
			keep([text], [{ fieldId: 'f_text', operator: 'contains', value: 'an' }]),
		).toEqual(['b']);
	});

	it('excludes what contains it', () => {
		expect(
			keep([text], [{ fieldId: 'f_text', operator: 'notContains', value: 'an' }]),
		).toEqual(['a', 'c', 'd']);
	});
});

describe('the number operators', () => {
	it('compares as numbers, not as text', () => {
		// As text, `10` sorts before `5`.
		expect(
			keep([number], [{ fieldId: 'f_num', operator: 'greaterThan', value: 5 }]),
		).toEqual(['c']);
	});

	it('matches a number exactly', () => {
		expect(
			keep([number], [{ fieldId: 'f_num', operator: 'is', value: 5 }]),
		).toEqual(['b']);
	});

	it('does not treat an empty cell as zero', () => {
		/*
		 * The defect this pins: `Number('')` is 0, so an empty cell would pass
		 * `is 0` and `is not 5` alike — an absence read as a value.
		 */
		expect(keep([number], [{ fieldId: 'f_num', operator: 'is', value: 0 }])).toEqual(
			[],
		);
	});
});

describe('dates', () => {
	it('compares by the day named, not by the text', () => {
		expect(
			keep([date], [{ fieldId: 'f_date', operator: 'greaterThan', value: '2026-02-01' }]),
		).toEqual(['b', 'c']);
	});

	it('matches one day', () => {
		expect(
			keep([date], [{ fieldId: 'f_date', operator: 'is', value: '2026-01-10' }]),
		).toEqual(['a']);
	});

	it('matches nothing when the value written in the condition is not a date', () => {
		/*
		 * The panel's date picker cannot produce this, but a view written by hand or
		 * by an older build can. A made-up day count would quietly keep the wrong
		 * rows; refusing to compare keeps none of them.
		 */
		expect(
			keep([date], [{ fieldId: 'f_date', operator: 'greaterThan', value: '2026-13-45' }]),
		).toEqual([]);
	});
});

describe('a date-time keeps the moment, a date only the day', () => {
	const at: Field = { id: 'f_at', name: 'At', type: 'datetime' };
	const times = [
		row('morning', { f_at: '2026-02-01T09:00' }),
		row('evening', { f_at: '2026-02-01T18:00' }),
		row('next', { f_at: '2026-02-02T08:00' }),
	];

	/** The ids this column keeps under one ordered condition. */
	function keepAt(
		operator: FilterCondition['operator'],
		value: string,
	): string[] {
		return filterRecords(times, [at], {
			conjunction: 'and',
			conditions: [{ fieldId: 'f_at', operator, value }],
		}).map((record) => record.id);
	}

	it('keeps the rest of the day when the condition names only its start', () => {
		/*
		 * The defect this pins: with both sides reduced to a day, "later than
		 * 1 February" was false for everything that happened on 1 February — the
		 * words say the opposite.
		 */
		expect(keepAt('greaterThan', '2026-02-01')).toEqual([
			'morning',
			'evening',
			'next',
		]);
	});

	it('keeps only what started before the next day', () => {
		expect(keepAt('lessThan', '2026-02-02')).toEqual(['morning', 'evening']);
	});

	it('compares a time written into the condition too', () => {
		expect(keepAt('greaterThan', '2026-02-01T10:00')).toEqual(['evening', 'next']);
	});
});

describe('choices and checkboxes', () => {
	it('filters a choice by the name it shows, not the id it stores', () => {
		// Filtering on the stored id would mean nothing to whoever wrote the rule.
		expect(
			keep([select], [{ fieldId: 'f_sel', operator: 'is', value: 'Done' }]),
		).toEqual(['a']);
	});

	it('filters ticks and unticked boxes', () => {
		expect(keep([box], [{ fieldId: 'f_box', operator: 'checked' }])).toEqual([
			'a',
			'c',
		]);
		expect(keep([box], [{ fieldId: 'f_box', operator: 'unchecked' }])).toEqual([
			'b',
			'd',
		]);
	});
});

describe('emptiness', () => {
	it('keeps blank cells', () => {
		expect(keep([text], [{ fieldId: 'f_text', operator: 'isEmpty' }])).toEqual(['d']);
	});

	it('keeps filled ones', () => {
		expect(
			keep([text], [{ fieldId: 'f_text', operator: 'isNotEmpty' }]),
		).toEqual(['a', 'b', 'c']);
	});
});

describe('several conditions', () => {
	it('requires all of them with "and"', () => {
		expect(
			keep(
				[text, box],
				[
					{ fieldId: 'f_text', operator: 'isNotEmpty' },
					{ fieldId: 'f_box', operator: 'checked' },
				],
				'and',
			),
		).toEqual(['a', 'c']);
	});

	it('accepts any of them with "or"', () => {
		expect(
			keep(
				[text],
				[
					{ fieldId: 'f_text', operator: 'is', value: 'apple' },
					{ fieldId: 'f_text', operator: 'is', value: 'cherry' },
				],
				'or',
			),
		).toEqual(['a', 'c']);
	});
});

describe('a filter that should keep everything', () => {
	it('keeps every row when it has no conditions', () => {
		expect(filterRecords(rows, [text], { conjunction: 'and', conditions: [] })).toHaveLength(4);
	});

	it('keeps every row when the column is gone', () => {
		// A deleted column must not empty the table.
		expect(
			keep([text], [{ fieldId: 'gone', operator: 'is', value: 'x' }]),
		).toEqual(['a', 'b', 'c', 'd']);
	});

	it('keeps every row when there is no filter at all', () => {
		expect(filterRecords(rows, [text], undefined)).toHaveLength(4);
	});
});

describe('what may be filtered on', () => {
	/*
	 * A computed column used to be refused here, because the model cannot work out its
	 * value. It can now be filtered: the view hands that text in through a resolver.
	 */
	it('filters a computed column through the text handed in', () => {
		const computed: Field = { id: 'f_c', name: 'C', type: 'formula' };
		const rows = [row('r1', {}), row('r2', {})];
		const kept = filterRecords(
			rows,
			[computed],
			{
				conjunction: 'and',
				conditions: [{ fieldId: 'f_c', operator: 'is', value: 'yes' }],
			},
			undefined,
			(field, record) =>
				field.id === 'f_c' ? (record.id === 'r1' ? 'yes' : 'no') : null,
		);
		expect(kept.map((entry) => entry.id)).toEqual(['r1']);
	});

	it('offers only the operators a column can answer', () => {
		expect(operatorsFor(box)).toEqual(['checked', 'unchecked']);
		expect(operatorsFor(text)).toContain('contains');
		// Words have no order here, so no greater-or-less for text.
		expect(operatorsFor(text)).not.toContain('greaterThan');
		expect(operatorsFor(number)).toContain('greaterThan');
	});

	it('knows which operators need a value', () => {
		expect(needsValue('is')).toBe(true);
		expect(needsValue('isEmpty')).toBe(false);
		expect(needsValue('checked')).toBe(false);
	});
});

describe('filtering a relation', () => {
	/*
	 * A relation stores row ids, which mean nothing to a reader. The names come from
	 * the other table, so the caller supplies them — the same resolution the cell is
	 * drawn with. Comparing the ids, which this once did, could never match
	 * anything a person typed.
	 */
	const relation: Field = { id: 'f_rel', name: 'Linked', type: 'relation' };

	/** A resolver standing in for the other table: ids to display names. */
	const resolve = (_field: Field, value: CellValue): string[] => {
		const ids = Array.isArray(value) ? value : [];
		const names: Record<string, string> = {
			p1: 'Ann',
			p2: 'Bob',
			p3: 'Anna',
		};
		return ids.map((id) => names[String(id)] ?? String(id));
	};

	const linked = [
		row('one', { f_rel: ['p1'] }),
		row('both', { f_rel: ['p1', 'p2'] }),
		row('anna', { f_rel: ['p3'] }),
		row('none', { f_rel: [] }),
	];

	function keepLinked(value: string, operator: FilterCondition['operator']): string[] {
		return filterRecords(
			linked,
			[relation],
			{ conjunction: 'and', conditions: [{ fieldId: 'f_rel', operator, value }] },
			resolve,
		).map((r) => r.id);
	}

	it('matches the name the cell shows, not the id it stores', () => {
		expect(keepLinked('Ann', 'is')).toEqual(['one']);
	});

	it('treats "is" as exactly this row and nothing else', () => {
		// `both` also points at Ann, but it is not a row about Ann alone.
		expect(keepLinked('Ann', 'is')).not.toContain('both');
	});

	it('treats "contains" as any of the linked rows', () => {
		expect(keepLinked('Ann', 'contains')).toEqual(['one', 'both']);
	});

	it('matches an exact name, not a prefix, for contains', () => {
		// `Anna` is a different row, so searching Ann must not also find her.
		expect(keepLinked('Ann', 'contains')).not.toContain('anna');
	});

	it('excludes rows that do not point at the name', () => {
		expect(keepLinked('Ann', 'notContains')).toEqual(['anna', 'none']);
	});

	it('inverts "is" for "is not"', () => {
		expect(keepLinked('Ann', 'isNot')).toEqual(['both', 'anna', 'none']);
	});

	it('still answers emptiness without the resolver', () => {
		// An id list is all it takes to know whether anything is linked.
		expect(
			filterRecords(
				linked,
				[relation],
				{
					conjunction: 'and',
					conditions: [{ fieldId: 'f_rel', operator: 'isEmpty' }],
				},
			).map((r) => r.id),
		).toEqual(['none']);
	});

	it('matches nothing when there are no names to compare', () => {
		// Without a resolver there is nothing to match, and comparing ids would
		// invent a match that cannot appear on screen.
		expect(keepLinked('p1', 'contains')).toEqual([]);
	});
});