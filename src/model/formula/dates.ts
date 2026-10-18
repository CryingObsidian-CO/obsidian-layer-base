import { addDays, dateField, dayNumber } from '../date';

/**
 * Dates as a formula sees them, and the only place the real clock is read.
 *
 * The calendar arithmetic itself lives in `model/date.ts`, which is deliberately
 * free of `Date`; what happens here is turning a cell's text into a day count, and
 * turning "now" into the text a cell would hold. The clock is passed in rather
 * than read inside, so a test can say what day it is.
 */

function pad2(value: number): string {
	return value < 10 ? `0${value}` : String(value);
}

/** Today's date, as a date cell would store it. */
export function todayIso(now: Date): string {
	return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** This minute, as a date-time cell would store it. */
export function nowIso(now: Date): string {
	return `${todayIso(now)}T${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

/** Days from one date to another, or null when either is not a date. */
export function daysBetween(from: string, to: string): number | null {
	const start = dayNumber(from);
	const end = dayNumber(to);
	if (start === null || end === null) {
		return null;
	}
	return end - start;
}

/** A date moved by whole days, or null when it is not a date or not a whole count. */
export function shiftDays(text: string, days: number): string | null {
	return addDays(text, days);
}

/** The year, month or day a date carries, or null when it is not a date. */
export function partOf(text: string, which: 'year' | 'month' | 'day'): number | null {
	return dateField(text, which);
}
