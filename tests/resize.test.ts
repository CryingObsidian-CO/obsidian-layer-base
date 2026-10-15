import { describe, expect, it } from 'vitest';
import { resizeSizeAt } from '../src/views/grid/resize';
import {
	MAX_COLUMN_WIDTH,
	MAX_ROW_HEIGHT,
	MIN_COLUMN_WIDTH,
	MIN_ROW_HEIGHT,
	clampColumnWidth,
	clampRowHeight,
} from '../src/model/layout';

const X = 500;
const Y = 300;

describe('resizeSizeAt', () => {
	it('ignores movement too small to be a drag', () => {
		expect(resizeSizeAt(180, X, X + 1, clampColumnWidth)).toBeNull();
		expect(resizeSizeAt(180, X, X - 1, clampColumnWidth)).toBeNull();
		expect(resizeSizeAt(180, X, X, clampColumnWidth)).toBeNull();
	});

	it('starts moving once the threshold is reached', () => {
		expect(resizeSizeAt(180, X, X + 2, clampColumnWidth)).toBe(182);
		expect(resizeSizeAt(180, X, X - 2, clampColumnWidth)).toBe(178);
	});

	it('measures from the size given for this gesture, not a stored one', () => {
		// The regression this guards: a column resized twice, with the second
		// gesture measuring from the width captured when the grid was built
		// rather than from the width the first gesture left behind. The column
		// snapped back to the stale value before following the pointer.
		const builtAt = 180;
		const afterFirstDrag = 260;

		const secondDrag = resizeSizeAt(
			afterFirstDrag,
			X,
			X + 10,
			clampColumnWidth,
		);

		expect(secondDrag).toBe(270);
		expect(secondDrag).not.toBe(resizeSizeAt(builtAt, X, X + 10, clampColumnWidth));
	});

	it('holds still when a second gesture does not move at all', () => {
		expect(resizeSizeAt(260, X, X, clampColumnWidth)).toBeNull();
	});

	it('keeps a drag inside the column bounds', () => {
		expect(resizeSizeAt(180, X, X + 5000, clampColumnWidth)).toBe(
			MAX_COLUMN_WIDTH,
		);
		expect(resizeSizeAt(180, X, X - 5000, clampColumnWidth)).toBe(
			MIN_COLUMN_WIDTH,
		);
	});

	it('clamps rows on the same scale', () => {
		expect(resizeSizeAt(32, Y, Y + 5000, clampRowHeight)).toBe(MAX_ROW_HEIGHT);
		expect(resizeSizeAt(32, Y, Y - 5000, clampRowHeight)).toBe(MIN_ROW_HEIGHT);
	});

	it('grows as the pointer travels further from where it went down', () => {
		expect(resizeSizeAt(180, X, X + 5, clampColumnWidth)).toBe(185);
		expect(resizeSizeAt(180, X, X + 50, clampColumnWidth)).toBe(230);
		expect(resizeSizeAt(180, X, X + 500, clampColumnWidth)).toBe(680);
	});
});