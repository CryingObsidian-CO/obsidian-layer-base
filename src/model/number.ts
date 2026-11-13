import type { Field, NumberFormat } from '../types';

/** Decimal places offered in the field editor; beyond this a number is noise. */
export const MAX_DECIMALS = 6;

export function normaliseFormat(format: NumberFormat | undefined): NumberFormat {
	return format === 'percent' ? 'percent' : 'plain';
}

/** Non-finite and missing decimals mean "as typed". */
export function normaliseDecimals(decimals: number | undefined): number | null {
	if (decimals === undefined || !Number.isFinite(decimals)) {
		return null;
	}
	return Math.min(MAX_DECIMALS, Math.max(0, Math.round(decimals)));
}

/** Keeps digits, one decimal point and a leading minus while typing; the commit still parses strictly. */
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
	// A lone '-' is kept: it is a number still being typed, rejected only on commit.
	return negative ? `-${digits}` : digits;
}

export function parseNumber(text: string): number | null {
	const trimmed = text.trim().replace(/%$/, '').trim();
	if (trimmed === '') {
		return null;
	}
	const value = Number(trimmed);
	return Number.isFinite(value) ? value : null;
}

/**
 * A percent field stores a proportion (`0.15` is fifteen percent); every conversion goes
 * through here, so a cell, a bound and a filter cannot disagree about the scale.
 */
function scaleOf(format: NumberFormat | undefined): number {
	return normaliseFormat(format) === 'percent' ? 100 : 1;
}

export function shownNumber(value: number, format: NumberFormat | undefined): number {
	// 0.15 * 100 is 15.000000000000002, which is not what the reader typed.
	return Number((value * scaleOf(format)).toPrecision(12));
}

export function storedNumber(value: number, format: NumberFormat | undefined): number {
	const scale = scaleOf(format);
	// 12.3 / 100 is 0.12300000000000001 in binary.
	return scale === 1 ? value : Number((value / scale).toPrecision(12));
}

/** A trailing `%` makes it a hundredth: `50%` is 0.5, which is what a percent field stores. */
export function parseShownNumber(text: string): number | null {
	const trimmed = text.trim();
	const parsed = parseNumber(trimmed);
	if (parsed === null) {
		return null;
	}
	return trimmed.endsWith('%') ? parsed / 100 : parsed;
}

/**
 * A trailing `%` always means percent; in a percent field a bare number is percent too, so
 * `100` and `100%` both store 1.
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
 * Rounding happens in the reader's units, not the stored ones: a percent field with one
 * decimal keeps 0.125. A value outside the bounds is clamped rather than refused, so it
 * lands visibly on the bound instead of silently not being saved.
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

export function parseOptionalNumber(text: string): number | null {
	const trimmed = text.trim();
	if (trimmed === '') {
		return null;
	}
	const value = Number(trimmed);
	return Number.isFinite(value) ? value : null;
}

export function formatNumber(value: number, field: Field): string {
	const decimals = normaliseDecimals(field.decimals);
	const shown = shownNumber(value, field.numberFormat);
	const body = decimals === null ? String(shown) : shown.toFixed(decimals);
	return normaliseFormat(field.numberFormat) === 'percent' ? `${body}%` : body;
}

/** Out-of-range values are not rejected on the way in; they are stored clamped. */
export function isWithinBounds(value: number, field: Field): boolean {
	if (typeof field.min === 'number' && value < field.min) {
		return false;
	}
	if (typeof field.max === 'number' && value > field.max) {
		return false;
	}
	return true;
}
