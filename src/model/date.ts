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

/** A date or date-time split into the two halves it is written in. */
export interface DateParts {
	/** The `YYYY-MM-DD` half. */
	date: string;
	/** The `HH:mm` half, or null when the value is a date alone. */
	time: string | null;
}

/** Splits a stored date or date-time, or answers null when it is neither. */
export function dateParts(text: string): DateParts | null {
	const date = normaliseDate(text);
	if (date !== null) {
		return { date, time: null };
	}
	const moment = normaliseDateTime(text);
	if (moment === null) {
		return null;
	}
	return { date: moment.slice(0, 10), time: moment.slice(11) };
}

/*
 * Day arithmetic without `Date`, by the standard civil-from-days conversion.
 *
 * `Date` cannot be used for this: it counts milliseconds in the local zone, so a
 * difference across a daylight-saving change is 23 or 25 hours rather than a day,
 * and the count would silently depend on where the reader lives. These two are
 * plain integer arithmetic on the calendar, which is what a column of dates means.
 */
function daysFromCivil(year: number, month: number, day: number): number {
	const y = year - (month <= 2 ? 1 : 0);
	const era = Math.floor(y / 400);
	const yoe = y - era * 400;
	const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
	const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
	return era * 146097 + doe - 719468;
}

function civilFromDays(days: number): { year: number; month: number; day: number } {
	const z = days + 719468;
	const era = Math.floor(z / 146097);
	const doe = z - era * 146097;
	const yoe = Math.floor(
		(doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
	);
	const y = yoe + era * 400;
	const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
	const mp = Math.floor((5 * doy + 2) / 153);
	const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
	const month = mp + (mp < 10 ? 3 : -9);
	return { year: y + (month <= 2 ? 1 : 0), month, day };
}

/** Whole days from 1970-01-01, so two dates can be subtracted; null if not a date. */
export function dayNumber(text: string): number | null {
	const parts = dateParts(text);
	if (parts === null) {
		return null;
	}
	const [year, month, day] = parts.date.split('-').map(Number);
	if (year === undefined || month === undefined || day === undefined) {
		return null;
	}
	return daysFromCivil(year, month, day);
}

/**
 * The same value moved by a whole number of days, keeping any time it carried.
 *
 * Null when the text is not a date or the shift is not a whole number: a column of
 * dates shifted by half a day has no meaning here, and rounding it would be a
 * silent guess.
 */
export function addDays(text: string, days: number): string | null {
	const parts = dateParts(text);
	const from = dayNumber(text);
	if (parts === null || from === null || !Number.isInteger(days)) {
		return null;
	}
	const civil = civilFromDays(from + days);
	const date = `${civil.year}-${pad2(civil.month)}-${pad2(civil.day)}`;
	return parts.time === null ? date : `${date}T${parts.time}`;
}

/** The year, month or day of a stored date, or null when it is not one. */
export function dateField(text: string, which: 'year' | 'month' | 'day'): number | null {
	const parts = dateParts(text);
	if (parts === null) {
		return null;
	}
	const [year, month, day] = parts.date.split('-').map(Number);
	if (year === undefined || month === undefined || day === undefined) {
		return null;
	}
	return which === 'year' ? year : which === 'month' ? month : day;
}
