import { describe, expect, it, vi } from 'vitest';
import { generateId } from '../src/utils/id';

describe('generateId', () => {
	it('keeps the prefix and never repeats itself in one run', () => {
		const ids = new Set(Array.from({ length: 5000 }, () => generateId('r')));

		expect(ids.size).toBe(5000);
		for (const id of ids) {
			expect(id.startsWith('r_')).toBe(true);
		}
	});

	it('differs between two runs that share a millisecond', async () => {
		/*
		 * The counter restarts at zero in every run, so two processes writing in the
		 * same millisecond used to reach the same counter step and produce one string.
		 * A fresh module instance is what a second run has; an id is the key that says
		 * where a cell's value is stored, so this is the difference between two rows
		 * and two rows sharing a cell.
		 */
		vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);

		vi.resetModules();
		const first = await import('../src/utils/id');
		const a = first.generateId('r');

		vi.resetModules();
		const second = await import('../src/utils/id');
		const b = second.generateId('r');

		vi.restoreAllMocks();

		expect(a.startsWith('r_')).toBe(true);
		expect(a).not.toBe(b);
	});
});
