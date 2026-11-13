import type { Field } from '../types';

/** Digit width only: the numbers are positions worked out in `numbering.ts`, and nothing is stored,
 * so there is no value to read back. */

export function paddingOf(field: Field): number {
	const length = field.numberLength ?? 1;
	if (!Number.isFinite(length) || length < 1) {
		return 1;
	}
	return Math.min(Math.floor(length), 12);
}

/** Leading zeros to a minimum width; a longer number is not cut down. */
export function padNumber(value: number, length: number): string {
	const text = String(Math.trunc(value));
	const width = Math.max(1, Math.min(Math.floor(length), 12));
	return text.length >= width ? text : '0'.repeat(width - text.length) + text;
}
