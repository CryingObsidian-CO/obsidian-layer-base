import type { Field } from '../types';

/**
 * How a numbering column's digits are written.
 *
 * The numbers themselves are positions, worked out from the rows in
 * `numbering.ts`; only the width lives here, so it reads and tests without a
 * document. Nothing is stored, so there is no value to read back.
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
