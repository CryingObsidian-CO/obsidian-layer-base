import { describe, expect, it } from 'vitest';
import { aggregateRollup } from '../src/model/rollup';
import type { CellValue } from '../src/types';

/** The text a rollup answered, or '—' when it had nothing to report. */
function text(values: readonly CellValue[], how: Parameters<typeof aggregateRollup>[1]): string {
	return aggregateRollup(values, how)?.text ?? '—';
}

describe('reducing the gathered values', () => {
	it('adds numbers up', () => {
		expect(text([100, 250], 'sum')).toBe('350');
		expect(text([0.1, 0.2], 'sum')).toBe('0.3');
	});

	it('averages them', () => {
		expect(text([100, 250], 'average')).toBe('175');
		expect(text([1, 2], 'average')).toBe('1.5');
	});

	it('takes the smallest and largest', () => {
		expect(text([100, 250, 80], 'min')).toBe('80');
		expect(text([100, 250, 80], 'max')).toBe('250');
	});

	it('answers the earliest and latest date, as a date', () => {
		// The reason min and max accept dates: "when is the first deadline" is a
		// question a table of children actually gets asked.
		expect(text(['2026-10-18', '2026-03-07', '2026-12-01'], 'min')).toBe('2026-03-07');
		expect(text(['2026-10-18', '2026-03-07', '2026-12-01'], 'max')).toBe('2026-12-01');
	});

	it('keeps the time of day when the values are date-times', () => {
		const times = ['2026-03-07T09:00', '2026-03-07T18:00'];

		/*
		 * Both values fall on the same day, so a comparison of days made them a tie
		 * and the first one won: the latest deadline of a day answered 09:00.
		 */
		expect(text(times, 'min')).toBe('2026-03-07T09:00');
		expect(text(times, 'max')).toBe('2026-03-07T18:00');
		expect(text(['2026-03-07T18:00', '2026-03-08T09:00'], 'max')).toBe('2026-03-08T09:00');
	});

	it('counts the filled values, not the rows', () => {
		expect(text([1, '', 3], 'count')).toBe('2');
		expect(text([1, '', 3], 'countAll')).toBe('3');
	});

	it('counts every row even when nothing is filled', () => {
		expect(text(['', '', ''], 'countAll')).toBe('3');
		expect(text(['', '', ''], 'count')).toBe('0');
	});

	it('reads a percent as the fraction it stands for', () => {
		expect(text(['50%', '25%'], 'sum')).toBe('0.75');
	});

	it('ignores a value that is not a number rather than failing the whole column', () => {
		expect(text([100, 'n/a', 250], 'sum')).toBe('350');
	});

	it('compares text when the values are not numbers or dates', () => {
		expect(text(['pear', 'apple'], 'min')).toBe('apple');
		expect(text(['pear', 'apple'], 'max')).toBe('pear');
	});
});

describe('a rollup over no rows at all', () => {
	it('reports nothing for the aggregates that need a value', () => {
		// "No children" and "the total is nothing" are different facts, and the cell
		// shows the first as empty rather than as a zero it cannot justify.
		for (const how of ['sum', 'average', 'min', 'max'] as const) {
			expect(aggregateRollup([], how), how).toBeNull();
		}
	});

	it('reports zero for the two counts, which have a true answer', () => {
		expect(text([], 'count')).toBe('0');
		expect(text([], 'countAll')).toBe('0');
	});
});

describe('a rollup whose column is filled with nothing', () => {
	it('reports nothing for a total, because there is no number to add', () => {
		expect(aggregateRollup(['', '', ''], 'sum')).toBeNull();
		expect(aggregateRollup(['', '', ''], 'average')).toBeNull();
	});

	it('reports nothing for a smallest or largest value', () => {
		expect(aggregateRollup(['', ''], 'min')).toBeNull();
		expect(aggregateRollup(['', ''], 'max')).toBeNull();
	});
});

describe('the kind a rollup reports', () => {
	it('calls a total a number, so it lines up on the right', () => {
		expect(aggregateRollup([1, 2], 'sum')?.kind).toBe('number');
		expect(aggregateRollup([1, 2], 'count')?.kind).toBe('number');
	});

	it('calls a chosen date text, because that is how a date is stored', () => {
		expect(aggregateRollup(['2026-03-07', '2026-10-18'], 'min')?.kind).toBe('text');
	});
});
