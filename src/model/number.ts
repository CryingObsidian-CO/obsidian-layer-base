import type { Field, NumberFormat } from '../types';

/** Decimal places offered in the field editor; beyond this a number is noise. */
export const MAX_DECIMALS = 6;

export function normaliseFormat(format: NumberFormat | undefined): NumberFormat {
	return format === 'percent' ? 'percent' : 'plain';
}

/** A valid decimals setting, or `null` for "as typed". */
export function normaliseDecimals(decimals: number | undefined): number | null {
	if (decimals === undefined || !Number.isFinite(decimals)) {
		return null;
	}
	return Math.min(MAX_DECIMALS, Math.max(0, Math.round(decimals)));
}

/**
 * Keeps only what can belong to a number: digits, one decimal point, and a minus
 * sign at the front. Applied while typing so a stray letter never appears in the
 * cell; the value is still parsed strictly on commit.
 */
export function sanitizeNumericInput(text: string): string {
	const negative = text.trimStart().startsWith('-');
	let digits = '';
	let seenDot = false;
	for (const char of text) {
		if (char >= '0' && char <= '9') {
			digits += char;
		} else if (char === '.' && !seenDot) {
			seenDot = true;
			digits += char;
		}
	}
	// A lone '-' or '.' is not a number yet, but it is a number being typed, so it
	// is kept and only rejected when the edit ends.
	return negative ? `-${digits}` : digits;
}

/** The number a cell's text means, or `null` when it means no number. */
export function parseNumber(text: string): number | null {
	const trimmed = text.trim().replace(/%$/, '').trim();
	if (trimmed === '') {
		return null;
	}
	const value = Number(trimmed);
	return Number.isFinite(value) ? value : null;
}

/**
 * How many of the units a reader sees make one stored unit.
 *
 * A percent field stores a proportion: `0.15` is fifteen percent, so a hundred of
 * the reader's units is one of the file's. Every conversion in the app goes
 * through here, so a cell, a bound and a filter cannot disagree about the scale.
 */
function scaleOf(format: NumberFormat | undefined): number {
	return normaliseFormat(format) === 'percent' ? 100 : 1;
}

/** A stored number in the units the reader types and sees. */
export function shownNumber(value: number, format: NumberFormat | undefined): number {
	// Rounded because fifty percent cannot always be multiplied back exactly:
	// 0.15 * 100 is 15.000000000000002, which is not what the reader typed.
	return Number((value * scaleOf(format)).toPrecision(12));
}

/** The number to store for what the reader typed in those units. */
export function storedNumber(value: number, format: NumberFormat | undefined): number {
	const scale = scaleOf(format);
	// Divided down and tidied: 12.3 / 100 is 0.12300000000000001 in binary, and that
	// is not a number any reader would recognise in the file.
	return scale === 1 ? value : Number((value / scale).toPrecision(12));
}

/**
 * The number a piece of display text stands for.
 *
 * A trailing `%` makes it a hundredth: `50%` is 0.5, which is what a percent
 * field stores and what arithmetic on the value works in.
 */
export function parseShownNumber(text: string): number | null {
	const trimmed = text.trim();
	const parsed = parseNumber(trimmed);
	if (parsed === null) {
		return null;
	}
	return trimmed.endsWith('%') ? parsed / 100 : parsed;
}

/**
 * The number to store for text typed into a cell of this field.
 *
 * The sign always means percent; inside a percent field the number does too, so
 * `100`, `100%` and `1` beside it are all one hundred percent depending on where
 * they were typed — and only the first two are what the cell holds.
 */
export function parseNumberIn(field: Field, text: string): number | null {
	const trimmed = text.trim();
	if (trimmed.endsWith('%')) {
		return parseShownNumber(trimmed);
	}
	const parsed = parseNumber(trimmed);
	if (parsed === null) {
		return null;
	}
	return normaliseFormat(field.numberFormat) === 'percent' ? parsed / 100 : parsed;
}

/**
 * The value a field will actually store: rounded to its precision, then held
 * inside its bounds.
 *
 * The precision counts the digits the reader sees, not the digits in the file: a
 * percent field with one decimal keeps 12.5% (0.125), and rounding the stored
 * number to one place would have thrown that away as 0.1.
 *
 * Clamped rather than refused, so a value outside the range lands visibly on the
 * bound instead of silently not being saved.
 */
export function constrainNumber(value: number, field: Field): number {
	const decimals = normaliseDecimals(field.decimals);
	let result = value;
	if (decimals !== null) {
		const rounded = shownNumber(value, field.numberFormat).toFixed(decimals);
		result = storedNumber(Number(rounded), field.numberFormat);
	}
	if (typeof field.min === 'number' && result < field.min) {
		result = field.min;
	}
	if (typeof field.max === 'number' && result > field.max) {
		result = field.max;
	}
	return result;
}

/** A settings box: an empty value means "no setting", not zero. */
export function parseOptionalNumber(text: string): number | null {
	const trimmed = text.trim();
	if (trimmed === '') {
		return null;
	}
	const value = Number(trimmed);
	return Number.isFinite(value) ? value : null;
}

/** The text a number shows as: the reader's units, with `%` for a percent field. */
export function formatNumber(value: number, field: Field): string {
	const decimals = normaliseDecimals(field.decimals);
	const shown = shownNumber(value, field.numberFormat);
	const body = decimals === null ? String(shown) : shown.toFixed(decimals);
	return normaliseFormat(field.numberFormat) === 'percent' ? `${body}%` : body;
}

/** Whether a value sits inside the field's bounds. Out-of-range is stored clamped. */
export function isWithinBounds(value: number, field: Field): boolean {
	if (typeof field.min === 'number' && value < field.min) {
		return false;
	}
	if (typeof field.max === 'number' && value > field.max) {
		return false;
	}
	return true;
}
