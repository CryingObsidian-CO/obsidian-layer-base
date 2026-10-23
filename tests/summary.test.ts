import { describe, expect, it } from 'vitest';
import {
	canSummarize,
	summarize,
	summaryChoicesFor,
	type SummaryKind,
} from '../src/model/summary';
import type { CellValue, Field, LayerRecord } from '../src/types';

function row(id: string, cells: Record<string, CellValue>): LayerRecord {
	return { id, created: '2026-01-01T00:00:00.000Z', cells };
}

const number: Field = { id: 'f_num', name: 'Num', type: 'number' };
const percent: Field = {
	id: 'f_pct',
	name: 'Pct',
	type: 'number',
	numberFormat: 'percent',
};
const text: Field = { id: 'f_text', name: 'Text', type: 'text' };
const date: Field = { id: 'f_date', name: 'Date', type: 'date' };
const formula: Field = { id: 'f_calc', name: 'Calc', type: 'formula' };
const box: Field = { id: 'f_box', name: 'Box', type: 'checkbox' };

const rows = [
	row('a', { f_num: 10, f_text: 'x', f_date: '2026-03-07', f_box: true }),
	row('b', { f_num: 20, f_text: '', f_date: '2026-01-10' }),
	row('c', { f_num: 30, f_text: 'z', f_date: '2026-12-01', f_box: true }),
	row('d', {}),
];

describe('nothing is summarised unless asked', () => {
	it('reports nothing by default', () => {
		/*
		 * A table that added up every numeric column by itself would put figures under
		 * columns nobody asked to have counted.
		 */
		expect(summarize(number, rows, 'none')).toBe('');
	});
});

describe('the choices a column offers', () => {
	it('always offers the counts and the way to turn it off', () => {
		for (const field of [number, text, date, formula, box]) {
			const choices = summaryChoicesFor(field);
			expect(choices).toContain('none');
			expect(choices).toContain('filled');
			expect(choices).toContain('empty');
			expect(choices).toContain('unique');
		}
	});

	it('offers adding up for a number column', () => {
		const choices = summaryChoicesFor(number);
		expect(choices).toContain('sum');
		expect(choices).toContain('average');
		expect(choices).toContain('min');
		expect(choices).toContain('max');
	});

	it('offers a span rather than a total for a date column', () => {
		const choices = summaryChoicesFor(date);
		expect(choices).toContain('range');
		expect(choices).not.toContain('sum');
	});

	it('offers no adding up for text or a computed column', () => {
		expect(summaryChoicesFor(text)).not.toContain('sum');
		expect(summaryChoicesFor(formula)).not.toContain('sum');
	});

	it('refuses a way the column cannot answer', () => {
		expect(canSummarize(text, 'sum')).toBe(false);
		expect(canSummarize(text, 'filled')).toBe(true);
		expect(canSummarize(number, 'sum')).toBe(true);
	});
});

describe('counting the rows', () => {
	it('counts the filled and the empty separately', () => {
		expect(summarize(number, rows, 'filled')).toBe('3');
		expect(summarize(number, rows, 'empty')).toBe('1');
	});

	it('counts the values that appear exactly once', () => {
		/*
		 * `A, A, B` holds two distinct values but only one unique one. The count is of
		 * values that occur once, not of values that differ from each other.
		 */
		const repeated = [
			row('a', { f_text: 'A' }),
			row('b', { f_text: 'A' }),
			row('c', { f_text: 'B' }),
			row('d', { f_text: '' }),
		];
		expect(summarize(text, repeated, 'unique')).toBe('1');
	});

	it('counts each value that occurs once', () => {
		const mixed = [
			row('a', { f_text: 'A' }),
			row('b', { f_text: 'A' }),
			row('c', { f_text: 'B' }),
			row('d', { f_text: 'C' }),
		];
		expect(summarize(text, mixed, 'unique')).toBe('2');
	});

	it('answers nothing unique when every value repeats', () => {
		const allRepeated = [
			row('a', { f_text: 'A' }),
			row('b', { f_text: 'A' }),
		];
		expect(summarize(text, allRepeated, 'unique')).toBe('0');
	});

	it('counts a computed column by its stored cells', () => {
		// Its values are worked out elsewhere, so only the counts are answerable.
		expect(summarize(formula, rows, 'filled')).toBe('0');
	});
});

describe('adding up', () => {
	it('sums, averages and finds the ends', () => {
		expect(summarize(number, rows, 'sum')).toBe('60');
		expect(summarize(number, rows, 'average')).toBe('20');
		expect(summarize(number, rows, 'min')).toBe('10');
		expect(summarize(number, rows, 'max')).toBe('30');
	});

	it('writes the figure in the column format', () => {
		// Written with the column's own per cent sign, since that is how its cells read.
		const percentages = [
			row('a', { f_pct: 10 }),
			row('b', { f_pct: 20 }),
			row('c', { f_pct: 30 }),
		];
		expect(summarize(percent, percentages, 'sum')).toBe('60%');
	});

	it('answers nothing when there is nothing to add', () => {
		// A sum of no rows is not zero: there is no total to report.
		expect(summarize(number, [row('a', {})], 'sum')).toBe('');
	});
});

describe('the date span', () => {
	it('reports the earliest and the latest', () => {
		expect(summarize(date, rows, 'earliest')).toBe('2026-01-10');
		expect(summarize(date, rows, 'latest')).toBe('2026-12-01');
	});

	it('reports the range as one span', () => {
		expect(summarize(date, rows, 'range')).toBe('2026-01-10 – 2026-12-01');
	});

	it('collapses to one date when every row shares it', () => {
		const same = [
			row('a', { f_date: '2026-05-05' }),
			row('b', { f_date: '2026-05-05' }),
		];
		expect(summarize(date, same, 'range')).toBe('2026-05-05');
	});

	it('answers nothing when no row holds a date', () => {
		expect(summarize(date, [row('a', {})], 'range')).toBe('');
	});
});

describe('the figures follow the rows given', () => {
	it('sums only the rows handed over, which is what a filter leaves', () => {
		// The footer totals what is on screen rather than everything stored.
		const shown = [rows[0] as LayerRecord, rows[1] as LayerRecord];
		expect(summarize(number, shown, 'sum')).toBe('30');
	});
});

describe('a kind that does not apply', () => {
	it('answers nothing rather than something invented', () => {
		const kinds: SummaryKind[] = ['sum', 'average', 'earliest'];
		for (const kind of kinds) {
			expect(summarize(text, rows, kind)).toBe('');
		}
	});
});
