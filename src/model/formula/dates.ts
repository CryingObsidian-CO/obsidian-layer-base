import { addDays, dateField, dayNumber } from '../date';

/**
 * Turning a cell's text into day counts and "now" into cell text; the calendar arithmetic lives in
 * `model/date.ts`, and the clock is passed in so a test can say what day it is.
 */

function pad2(value: number): string {
	return value < 10 ? `0${value}` : String(value);
}

export function todayIso(now: Date): string {
	return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

export function nowIso(now: Date): string {
	return `${todayIso(now)}T${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

export function daysBetween(from: string, to: string): number | null {
	const start = dayNumber(from);
	const end = dayNumber(to);
	if (start === null || end === null) {
		return null;
	}
	return end - start;
}

export function shiftDays(text: string, days: number): string | null {
	return addDays(text, days);
}

export function partOf(text: string, which: 'year' | 'month' | 'day'): number | null {
	return dateField(text, which);
}
