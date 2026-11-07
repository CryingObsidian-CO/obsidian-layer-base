import { describe, expect, it } from 'vitest';
import { redrawOnce } from '../src/views/redraw-guard';

describe('redrawOnce', () => {
	it('ends the open edit before drawing', () => {
		const order: string[] = [];
		redrawOnce(
			{ busy: false },
			() => order.push('commit'),
			() => order.push('draw'),
		);
		expect(order).toEqual(['commit', 'draw']);
	});

	it('draws once when the commit asks for a redraw of its own', () => {
		const state = { busy: false };
		let draws = 0;
		let commits = 0;

		redrawOnce(
			state,
			() => {
				commits += 1;
				// A commit can redraw the view (a changed value moves the row, or
				// filters it out); that inner request must not start a second pass.
				redrawOnce(
					state,
					() => commits += 1,
					() => draws += 1,
				);
			},
			() => {
				draws += 1;
			},
		);

		expect(commits).toBe(1);
		expect(draws).toBe(1);
		expect(state.busy).toBe(false);
	});

	it('clears the guard even when drawing throws, so later redraws still run', () => {
		const state = { busy: false };
		expect(() =>
			redrawOnce(
				state,
				() => undefined,
				() => {
					throw new Error('boom');
				},
			),
		).toThrow('boom');
		expect(state.busy).toBe(false);

		let drawn = 0;
		redrawOnce(
			state,
			() => undefined,
			() => {
				drawn += 1;
			},
		);
		expect(drawn).toBe(1);
	});

	it('runs again on a later, separate call', () => {
		const state = { busy: false };
		let draws = 0;
		const pass = (): void =>
			redrawOnce(
				state,
				() => undefined,
				() => {
					draws += 1;
				},
			);
		pass();
		pass();
		expect(draws).toBe(2);
	});
});
