import { describe, expect, it } from 'vitest';
import {
	cardColumnsFor,
	columnLimitOf,
	DEFAULT_COLUMN_LIMIT,
	groupRecords,
	valueForColumn,
	type KanbanColumn,
} from '../src/model/kanban';
import type { CellValue, Field, KanbanView, LayerRecord } from '../src/types';
import { relationIds } from '../src/model/fields';

function row(id: string, cells: Record<string, CellValue>): LayerRecord {
	return { id, created: '2026-01-01T00:00:00.000Z', cells };
}

const status: Field = {
	id: 'f_status',
	name: 'Status',
	type: 'select',
	options: [
		{ id: 's_todo', name: 'To do', color: 'blue' },
		{ id: 's_doing', name: 'Doing', color: 'amber' },
		{ id: 's_done', name: 'Done', color: 'green' },
	],
};
const text: Field = { id: 'f_text', name: 'Text', type: 'text' };
const number: Field = { id: 'f_num', name: 'Num', type: 'number' };
const date: Field = { id: 'f_date', name: 'Date', type: 'date' };
const tags: Field = {
	id: 'f_tags',
	name: 'Tags',
	type: 'multiSelect',
	options: [
		{ id: 't_a', name: 'A', color: 'blue' },
		{ id: 't_b', name: 'B', color: 'red' },
	],
};
const formula: Field = { id: 'f_calc', name: 'Calc', type: 'formula' };
const box: Field = { id: 'f_box', name: 'Box', type: 'checkbox' };

function titles(columns: readonly KanbanColumn[]): string[] {
	return columns.map((column) => column.title);
}

function idsIn(columns: readonly KanbanColumn[], title: string): string[] {
	return columns.find((column) => column.title === title)?.recordIds ?? [];
}

describe('grouping by a choice column', () => {
	const rows = [
		row('a', { f_status: 's_todo' }),
		row('b', { f_status: 's_done' }),
		row('c', { f_status: 's_todo' }),
	];

	it('makes one column per option that is used', () => {
		const columns = groupRecords(rows, status, 50);
		expect(titles(columns)).toEqual(['To do', 'Done']);
	});

	it('puts the rows where they belong', () => {
		const columns = groupRecords(rows, status, 50);
		expect(idsIn(columns, 'To do')).toEqual(['a', 'c']);
		expect(idsIn(columns, 'Done')).toEqual(['b']);
	});

	it('keeps the order the options were defined in', () => {
		// The definition order is a choice the reader made; sorting them would undo it.
		const rows2 = [
			row('x', { f_status: 's_done' }),
			row('y', { f_status: 's_todo' }),
		];
		expect(titles(groupRecords(rows2, status, 50))).toEqual(['To do', 'Done']);
	});

	it('shows a stale option id rather than pooling it into ungrouped', () => {
		const rows3 = [row('z', { f_status: 'gone' })];
		const columns = groupRecords(rows3, status, 50);
		expect(titles(columns)).toEqual(['gone']);
		expect(idsIn(columns, 'gone')).toEqual(['z']);
	});
});

describe('the ungrouped column', () => {
	it('comes last and holds the rows with nothing in the column', () => {
		const rows = [row('a', { f_text: 'x' }), row('b', {})];
		const columns = groupRecords(rows, text, 50);
		expect(titles(columns)).toEqual(['x', '']);
		expect(columns[columns.length - 1]?.recordIds).toEqual(['b']);
	});

	it('is left out when no row needs it', () => {
		const rows = [row('a', { f_text: 'x' })];
		expect(titles(groupRecords(rows, text, 50))).toEqual(['x']);
	});

	it('is drawn when the board was asked to show unused columns', () => {
		const rows = [row('a', { f_text: 'x' })];
		expect(titles(groupRecords(rows, text, 50, undefined, true))).toEqual([
			'x',
			'',
		]);
	});

	it('accepts a drop, which clears the column', () => {
		const columns = groupRecords([row('a', {})], text, 50);
		expect(columns[columns.length - 1]?.droppable).toBe(true);
	});

	it('treats whitespace as nothing', () => {
		const columns = groupRecords([row('a', { f_text: '   ' })], text, 50);
		expect(columns[columns.length - 1]?.recordIds).toEqual(['a']);
	});
});

describe('grouping by other columns', () => {
	it('groups a number column by value, in numeric order', () => {
		const rows = [
			row('a', { f_num: 10 }),
			row('b', { f_num: 2 }),
			row('c', { f_num: 2 }),
		];
		const columns = groupRecords(rows, number, 50);
		expect(titles(columns)).toEqual(['2', '10']);
		expect(idsIn(columns, '2')).toEqual(['b', 'c']);
	});

	it('groups a date column by day, in date order', () => {
		const rows = [
			row('a', { f_date: '2026-12-01' }),
			row('b', { f_date: '2026-03-07' }),
		];
		expect(titles(groupRecords(rows, date, 50))).toEqual([
			'2026-03-07',
			'2026-12-01',
		]);
	});

	it('groups a text column by its text', () => {
		const rows = [row('a', { f_text: 'pear' }), row('b', { f_text: 'apple' })];
		expect(titles(groupRecords(rows, text, 50))).toEqual(['apple', 'pear']);
	});
});

describe('grouping a multiple-value column', () => {
	it('treats the whole selection as one column, not one per choice', () => {
		// `A, B` is one column title, so a row belongs to exactly that column.
		const rows = [
			row('a', { f_tags: ['t_a', 't_b'] }),
			row('b', { f_tags: ['t_a'] }),
		];
		const titles = groupRecords(rows, tags, 50).map((column) => column.title);
		expect(titles).toContain('A, B');
		expect(titles).toContain('A');
	});

	it('never puts the same row in two columns', () => {
		const rows = [row('a', { f_tags: ['t_a', 't_b'] })];
		const columns = groupRecords(rows, tags, 50);
		const appearances = columns.filter((column) =>
			column.recordIds.includes('a'),
		).length;
		expect(appearances).toBe(1);
	});
});

describe('columns that cannot be written', () => {
	it('marks a computed column as not droppable', () => {
		const rows = [row('a', {})];
		const resolve = (): string => 'computed';
		const columns = groupRecords(rows, formula, 50, resolve);
		expect(titles(columns)).toEqual(['computed']);
		expect(columns[0]?.droppable).toBe(false);
	});
});

describe('what a drop writes', () => {
	// A board draws only the columns its rows use, so the data needs a row in each column asked for.
	const columns = groupRecords(
		[row('a', { f_status: 's_todo' }), row('b', { f_status: 's_done' })],
		status,
		50,
	);
	const done = columns.find((column) => column.title === 'Done') as KanbanColumn;

	it('writes the option id, not the name it shows', () => {
		expect(valueForColumn(status, done)).toBe('s_done');
	});

	it('writes plain text for a text column', () => {
		const textColumn: KanbanColumn = {
			value: 'apple',
			title: 'apple',
			recordIds: [],
			droppable: true,
			omitted: 0,
		};
		expect(valueForColumn(text, textColumn)).toBe('apple');
	});

	it('replaces a multiple selection rather than adding to it', () => {
		const tagColumn: KanbanColumn = {
			value: 'A',
			title: 'A',
			recordIds: [],
			droppable: true,
			omitted: 0,
		};
		expect(valueForColumn(tags, tagColumn)).toEqual(['t_a']);
	});

	it('writes a number as a number', () => {
		const numberColumn: KanbanColumn = {
			value: '42',
			title: '42',
			recordIds: [],
			droppable: true,
			omitted: 0,
		};
		expect(valueForColumn(number, numberColumn)).toBe(42);
	});
});

describe('a board grouped by a relation', () => {
	const link: Field = { id: 'f_link', name: 'Link', type: 'relation' };
	const NAMES: Record<string, string> = { r_ann: 'Ann', r_bob: 'Bob' };
	const show = (record: LayerRecord): string =>
		relationIds(record.cells.f_link ?? '')
			.map((id) => NAMES[id] ?? id)
			.join(', ');

	const columns = groupRecords(
		[
			row('a', { f_link: ['r_ann'] }),
			row('b', { f_link: ['r_ann', 'r_bob'] }),
			row('c', {}),
		],
		link,
		50,
		(_field, record) => show(record),
	);
	const annAndBob = columns.find((column) => column.title === 'Ann, Bob') as KanbanColumn;
	const ungrouped = columns[columns.length - 1] as KanbanColumn;

	it('groups by the names on screen', () => {
		expect(columns.map((column) => column.title)).toEqual(['Ann', 'Ann, Bob', '']);
	});

	it('keeps the ids it was grouped from, since a title cannot give them back', () => {
		expect(annAndBob.value).toEqual(['r_ann', 'r_bob']);
	});

	it('links those rows on a drop instead of clearing them', () => {
		expect(valueForColumn(link, annAndBob)).toEqual(['r_ann', 'r_bob']);
	});

	it('still clears a link when the card is dropped on no value', () => {
		expect(valueForColumn(link, ungrouped)).toEqual([]);
	});

	it('leaves every column droppable', () => {
		expect(columns.every((column) => column.droppable)).toBe(true);
	});
});

describe('the column limit', () => {
	it('defaults when the board has none', () => {
		const view = { columnLimit: undefined } as unknown as KanbanView;
		expect(columnLimitOf(view)).toBe(DEFAULT_COLUMN_LIMIT);
	});

	it('keeps a sensible value the board set for itself', () => {
		const view = { columnLimit: 12 } as unknown as KanbanView;
		expect(columnLimitOf(view)).toBe(12);
	});

	it('clamps a value that would never finish drawing', () => {
		expect(columnLimitOf({ columnLimit: 100000 } as unknown as KanbanView)).toBe(
			500,
		);
		expect(columnLimitOf({ columnLimit: 0 } as unknown as KanbanView)).toBe(1);
	});

	it('draws no more columns than the limit', () => {
		const rows = Array.from({ length: 20 }, (_, index) =>
			row(`r${index}`, { f_num: index }),
		);
		expect(groupRecords(rows, number, 5)).toHaveLength(5);
	});

	it('keeps a slot for the no-value column, whose cards have nowhere else to be', () => {
		const rows = [
			row('a', { f_text: 'apple' }),
			row('b', { f_text: 'pear' }),
			row('c', { f_text: '' }),
		];
		const drawn = groupRecords(rows, text, 2);

		expect(titles(drawn)).toEqual(['apple', '']);
		expect(drawn[1]?.recordIds).toEqual(['c']);
	});

	it('draws only the no-value column when the limit is one', () => {
		const rows = [row('a', { f_text: 'apple' }), row('b', { f_text: '' })];

		expect(titles(groupRecords(rows, text, 1))).toEqual(['']);
	});

	it('draws the whole board when the limit is not a number', () => {
		const rows = [row('a', { f_text: 'apple' }), row('b', { f_text: 'pear' })];

		// `Math.max(1, NaN)` is NaN and `slice(0, NaN)` is an empty board.
		expect(titles(groupRecords(rows, text, Number.NaN))).toEqual(['apple', 'pear']);
	});
});

describe('showing the columns a column could hold', () => {
	const rows = [row('a', { f_status: 's_todo' })];

	it('draws only the values in use by default', () => {
		expect(titles(groupRecords(rows, status, 50))).toEqual(['To do']);
	});

	it('draws every option when asked, with the unused "no value" column last', () => {
		expect(titles(groupRecords(rows, status, 50, undefined, true))).toEqual([
			'To do',
			'Doing',
			'Done',
			'',
		]);
	});

	it('keeps the option order, so the unused ones land where they belong', () => {
		const only = [row('a', { f_status: 's_done' })];
		expect(titles(groupRecords(only, status, 50, undefined, true))).toEqual([
			'To do',
			'Doing',
			'Done',
			'',
		]);
	});

	it('offers both states of a checkbox', () => {
		const ticked = [row('a', { f_box: true })];
		expect(titles(groupRecords(ticked, box, 50, undefined, true))).toEqual([
			'false',
			'true',
			'',
		]);
	});

	it('invents nothing for a column with no fixed set of values', () => {
		const rows2 = [row('a', { f_text: 'x' })];
		expect(titles(groupRecords(rows2, text, 50, undefined, true))).toEqual([
			'x',
			'',
		]);
	});

	it('counts the unused columns against the limit, keeping a slot for the no-value one', () => {
		const drawn = groupRecords(rows, status, 3, undefined, true);

		expect(drawn).toHaveLength(3);
		expect(titles(drawn)).toEqual(['To do', 'Doing', '']);
	});
});

describe('clearing a card by dropping it on the ungrouped column', () => {
	it('writes the empty value the column expects', () => {
		const columns = groupRecords(
			[row('a', { f_tags: ['t_a'] }), row('b', {})],
			tags,
			50,
		);
		const ungrouped = columns[columns.length - 1] as KanbanColumn;
		expect(valueForColumn(tags, ungrouped)).toEqual([]);

		const boxColumns = groupRecords(
			[row('a', { f_box: true }), row('b', {})],
			box,
			50,
		);
		expect(
			valueForColumn(box, boxColumns[boxColumns.length - 1] as KanbanColumn),
		).toBe(false);

		expect(valueForColumn(text, columns[columns.length - 1] as KanbanColumn)).toBe(
			'',
		);
	});
});
describe('dropping a card back onto the ungrouped column', () => {
	const rows = [row('a', { f_status: 's_todo' }), row('b', {})];

	function ungroupedOf(columns: readonly KanbanColumn[]): KanbanColumn {
		const column = columns[columns.length - 1];
		if (!column) {
			throw new Error('the board drew no columns');
		}
		return column;
	}

	it('offers the ungrouped column as a drop target', () => {
		const ungrouped = ungroupedOf(groupRecords(rows, status, 50));
		expect(ungrouped.value).toBeNull();
		expect(ungrouped.droppable).toBe(true);
	});

	it('writes the empty value for that column', () => {
		const ungrouped = ungroupedOf(groupRecords(rows, status, 50));
		expect(valueForColumn(status, ungrouped)).toBe('');
	});

	it('also works for a checkbox board', () => {
		// One unticked row, so the "no value" column exists for the ticked card to be dragged into.
		const rows = [row('a', { f_box: true }), row('b', { f_box: false })];
		const ungrouped = ungroupedOf(groupRecords(rows, box, 50));
		expect(ungrouped.droppable).toBe(true);
		expect(valueForColumn(box, ungrouped)).toBe(false);
	});

	it('refuses only when the grouping column cannot be written at all', () => {
		const columns = groupRecords([row('a', {})], formula, 50, () => 'computed');
		expect(columns[0]?.droppable).toBe(false);
	});
});
describe('the columns a card prints', () => {
	const fields = [status, text, number];
	const primaryField: Field = { ...text, primary: true };

	function boardView(extra: Partial<KanbanView> = {}): KanbanView {
		return {
			id: 'v',
			name: 'Board',
			type: 'kanban',
			groupByFieldId: status.id,
			cardFieldIds: [],
			filter: { conjunction: 'and', conditions: [] },
			sorts: [],
			hiddenFieldIds: [],
			...extra,
		};
	}

	it('titles a card with the column the board names', () => {
		const columns = cardColumnsFor(fields, boardView({ titleFieldId: number.id }));
		expect(columns.title?.id).toBe(number.id);
	});

	it('falls back to the table primary column when the board names none', () => {
		const columns = cardColumnsFor(
			[status, primaryField, number],
			boardView(),
		);
		expect(columns.title?.id).toBe(primaryField.id);
	});

	it('falls back again to the first column when nothing is primary', () => {
		const columns = cardColumnsFor([status, number], boardView());
		expect(columns.title?.id).toBe(status.id);
	});

	it('prints the columns it was told to, in the table order', () => {
		const columns = cardColumnsFor(
			fields,
			boardView({ cardFieldIds: [number.id, text.id] }),
		);
		expect(columns.shown.map((field) => field.id)).toEqual([text.id, number.id]);
	});

	it('never repeats the grouping column on a card', () => {
		const columns = cardColumnsFor(
			fields,
			boardView({ cardFieldIds: [status.id, text.id] }),
		);
		expect(columns.shown.map((field) => field.id)).toEqual([text.id]);
	});

	it('ignores a column that no longer exists', () => {
		const columns = cardColumnsFor(
			fields,
			boardView({ cardFieldIds: ['gone', text.id] }),
		);
		expect(columns.shown.map((field) => field.id)).toEqual([text.id]);
	});
});

describe('a board grouped by a percentage', () => {
	const rate: Field = { id: 'f_rate', name: 'Rate', type: 'number', numberFormat: 'percent' };
	// Stored as proportions, so these read as "10%" and "2%".
	const rows = [row('a', { f_rate: 0.1 }), row('b', { f_rate: 0.02 })];

	it('orders its columns by the number behind the title', () => {
		expect(groupRecords(rows, rate, 10).map((column) => column.title)).toEqual([
			'2%',
			'10%',
		]);
	});

	it('writes the proportion back when a card is dropped on a column', () => {
		const columns = groupRecords(rows, rate, 10);
		const ten = columns.find((column) => column.title === '10%') as KanbanColumn;

		expect(valueForColumn(rate, ten)).toBe(0.1);
	});
});