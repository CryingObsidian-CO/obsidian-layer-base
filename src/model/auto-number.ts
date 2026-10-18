import type { CellValue, Field } from '../types';

/**
 * The numbering an `autoNumber` column hands out. Free of the document: which
 * numbers are already taken is passed in, so the rules test without a table.
 */

/** How many digits a number is padded to; the setting, clamped to something sane. */
export function paddingOf(field: Field): number {
	const length = field.numberLength ?? 1;
	if (!Number.isFinite(length) || length < 1) {
		return 1;
	}
	return Math.min(Math.floor(length), 12);
}

/**
 * A number written with leading zeros.
 *
 * The width is a minimum, not a limit: the thousandth row of a three-wide column
 * shows `1000` rather than being cut down to a number that is already taken.
 */
export function padNumber(value: number, length: number): string {
	const text = String(Math.trunc(value));
	const width = Math.max(1, Math.min(Math.floor(length), 12));
	return text.length >= width ? text : '0'.repeat(width - text.length) + text;
}

/** What an `autoNumber` cell reads as: the number it stores, padded. */
export function numberText(field: Field, value: CellValue): string {
	const number = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(number)) {
		return '';
	}
	return padNumber(number, paddingOf(field));
}

/**
 * The next number to hand out, given the ones already taken.
 *
 * One past the highest, not one past the count: deleting the second of three rows
 * leaves `01` and `03`, and the next row is `04`. Reusing `02` would give two rows
 * the same number in the past, which is worse than a gap.
 */
export function nextNumber(used: readonly number[]): number {
	let highest = 0;
	for (const value of used) {
		if (Number.isFinite(value) && value > highest) {
			highest = Math.trunc(value);
		}
	}
	return highest + 1;
}

/** The number a cell holds, or null when it holds none. */
export function storedNumber(value: CellValue): number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? Math.trunc(value) : null;
	}
	if (typeof value === 'string' && value.trim() !== '') {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
	}
	return null;
}
