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
 * The value a field will actually store: rounded to its precision, then held
 * inside its bounds.
 *
 * Clamped rather than refused, so a value outside the range lands visibly on the
 * bound instead of silently not being saved.
 */
export function constrainNumber(value: number, field: Field): number {
	const decimals = normaliseDecimals(field.decimals);
	let result = decimals === null ? value : Number(value.toFixed(decimals));
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

/** The text a number shows as: fixed decimals when set, plus `%` for percent. */
export function formatNumber(value: number, field: Field): string {
	const decimals = normaliseDecimals(field.decimals);
	const body = decimals === null ? String(value) : value.toFixed(decimals);
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
