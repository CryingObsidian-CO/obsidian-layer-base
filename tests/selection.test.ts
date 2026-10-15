import { describe, expect, it } from 'vitest';
import { rangeBounds, rangeSize } from '../src/views/grid/selection';

const rows = new Map([
	['r1', 0],
	['r2', 1],
	['r3', 2],
]);
const columns = new Map([
	['c1', 0],
	['c2', 1],
	['c3', 2],
]);

const cell = (recordId: string, fieldId: string) => ({ recordId, fieldId });

describe('rangeBounds', () => {
	it('treats a single cell as a 1x1 range', () => {
		const bounds = rangeBounds(cell('r2', 'c2'), cell('r2', 'c2'), rows, columns);

		expect(bounds).toEqual({ top: 1, bottom: 1, left: 1, right: 1 });
		expect(bounds && rangeSize(bounds)).toEqual({ rows: 1, columns: 1 });
	});

	it('orders a drag that ran down and right', () => {
		const bounds = rangeBounds(cell('r1', 'c1'), cell('r3', 'c3'), rows, columns);

		expect(bounds).toEqual({ top: 0, bottom: 2, left: 0, right: 2 });
	});

	it('orders a drag that ran up and left', () => {
		const bounds = rangeBounds(cell('r3', 'c3'), cell('r1', 'c1'), rows, columns);

		expect(bounds).toEqual({ top: 0, bottom: 2, left: 0, right: 2 });
	});

	it('handles a drag along one row', () => {
		const bounds = rangeBounds(cell('r2', 'c1'), cell('r2', 'c3'), rows, columns);

		expect(bounds).toEqual({ top: 1, bottom: 1, left: 0, right: 2 });
		expect(bounds && rangeSize(bounds)).toEqual({ rows: 1, columns: 3 });
	});

	it('handles a drag down one column', () => {
		const bounds = rangeBounds(cell('r1', 'c2'), cell('r3', 'c2'), rows, columns);

		expect(bounds).toEqual({ top: 0, bottom: 2, left: 1, right: 1 });
		expect(bounds && rangeSize(bounds)).toEqual({ rows: 3, columns: 1 });
	});

	it('returns null when an end is no longer rendered', () => {
		expect(rangeBounds(cell('r_gone', 'c1'), cell('r1', 'c1'), rows, columns)).toBeNull();
		expect(rangeBounds(cell('r1', 'c1'), cell('r1', 'c_gone'), rows, columns)).toBeNull();
	});

	it('counts rows and columns inclusively at both ends', () => {
		const bounds = rangeBounds(cell('r1', 'c1'), cell('r2', 'c2'), rows, columns);

		expect(bounds && rangeSize(bounds)).toEqual({ rows: 2, columns: 2 });
	});
});
