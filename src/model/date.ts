/**
 * Dates and local wall-clock date-times, as the format stores them.
 *
 * Deliberately free of `Date`: parsing through it would drag the local timezone
 * and its leniency (`2026-02-30` becomes March 2) into values that are meant to
 * be plain calendar text. Everything here is arithmetic on the written form.
 */

/** `YYYY-MM-DD`, with either separator, single-digit month and day allowed. */
const DATE_PATTERN = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/;

/** `HH:mm`, single digits allowed, with optional seconds that are dropped. */
const TIME_PATTERN = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/;

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export function isLeapYear(year: number): boolean {
	return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
	if (month === 2 && isLeapYear(year)) {
		return 29;
	}
	return MONTH_LENGTHS[month - 1] ?? 0;
}

function pad2(value: number): string {
	return value < 10 ? `0${value}` : String(value);
}

/**
 * A calendar date as `YYYY-MM-DD`, or `null` when the text is not one.
 *
 * A month-first form like `10/17/2026` is refused rather than guessed at: it
 * could be either day- or month-first, and picking one silently would corrupt a
 * value the user can still correct.
 */
export function normaliseDate(text: string): string | null {
	const match = DATE_PATTERN.exec(text.trim());
	if (!match) {
		return null;
	}
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
		return null;
	}
	if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
		return null;
	}
	return `${year}-${pad2(month)}-${pad2(day)}`;
}

/**
 * A local wall-clock date-time as `YYYY-MM-DDTHH:mm`, or `null`.
 *
 * Both a `T` and a space are accepted between the halves, since that is the
 * difference between what is stored and what is shown. Seconds are dropped, and
 * a value carrying a zone is refused rather than converted — this format has no
 * zones to convert between.
 */
export function normaliseDateTime(text: string): string | null {
	const parts = text.trim().split(/[T ]/);
	const [datePart, timePart, ...rest] = parts;
	if (datePart === undefined || timePart === undefined || rest.length > 0) {
		return null;
	}
	const date = normaliseDate(datePart);
	if (date === null) {
		return null;
	}
	const time = TIME_PATTERN.exec(timePart);
	if (!time) {
		return null;
	}
	const hours = Number(time[1]);
	const minutes = Number(time[2]);
	if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
		return null;
	}
	if (hours > 23 || minutes > 59) {
		return null;
	}
	return `${date}T${pad2(hours)}:${pad2(minutes)}`;
}

/** How a date-time is shown: a space where the stored form keeps its `T`. */
export function displayDateTime(value: string): string {
	return value.replace('T', ' ');
}
