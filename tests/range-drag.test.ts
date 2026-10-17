import { describe, expect, it } from 'vitest';
import { isOnScrollbarStrip } from '../src/views/grid/range-drag';

describe('isOnScrollbarStrip', () => {
	it('counts a press on the bar, and not one on the text beside it', () => {
		// A cell ending at x=300 whose scrollbar takes the last 12px.
		expect(isOnScrollbarStrip(300, 300, 12)).toBe(true);
		expect(isOnScrollbarStrip(288, 300, 12)).toBe(true);
		expect(isOnScrollbarStrip(287, 300, 12)).toBe(false);
	});

	it('excludes nothing when the cell does not scroll', () => {
		// No scrollbar means no strip: every part of the cell is a drag handle.
		expect(isOnScrollbarStrip(300, 300, 0)).toBe(false);
		expect(isOnScrollbarStrip(299, 300, 0)).toBe(false);
	});

	it('says nothing is a scrollbar when the measurement is nonsense', () => {
		// A negative gutter cannot happen, and if it did it must not swallow cells.
		expect(isOnScrollbarStrip(300, 300, -5)).toBe(false);
	});

	it('does not reach past the cell it was asked about', () => {
		// A point beyond the right edge is outside the cell, and must not be read
		// as this cell's scrollbar.
		expect(isOnScrollbarStrip(400, 300, 12)).toBe(false);
	});
});
