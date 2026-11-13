/**
 * Dates and local wall-clock date-times as the format stores them. Free of `Date`: it drags
 * the local timezone and its leniency (`2026-02-30` becomes March 2) into plain calendar text.
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
 * The year is padded to four digits: `DATE_PATTERN` reads exactly four, and text this
 * module cannot read back is cleared on the next load.
 */
function formatDate(year: number, month: number, day: number): string {
	return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

/**
 * A month-first form like `10/17/2026` is refused rather than guessed at: either reading
 * is possible, and picking one silently would corrupt a value the user could still fix.
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
	return formatDate(year, month, day);
}

/**
 * `T` or a space is accepted, since that is the difference between stored and shown;
 * seconds are dropped, and a zone is refused rather than converted: this format has none.
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

export function displayDateTime(value: string): string {
	return value.replace('T', ' ');
}

export interface DateParts {
	date: string;
	time: string | null;
}

export function dateParts(text: string): DateParts | null {
	const date = normaliseDate(text);
	if (date !== null) {
		return { date, time: null };
	}
	const moment = normaliseDateTime(text);
	if (moment === null) {
		return null;
	}
	const [day, time] = moment.split('T');
	if (day === undefined || time === undefined) {
		return null;
	}
	return { date: day, time };
}

// Days from a civil date, the standard conversion. `Date` cannot do this: it counts
// milliseconds in the local zone, so a daylight-saving change makes a day 23 or 25 hours.
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
 * Whole minutes since 1970-01-01 00:00, wall clock, which is what a date column is ordered
 * by. Null when the text is not one: an unreadable value must not get a number placing it among real dates.
 */
export function dateMinutes(text: string): number | null {
	const parts = dateParts(text);
	if (parts === null) {
		return null;
	}
	const day = dayNumber(parts.date);
	if (day === null) {
		return null;
	}
	if (parts.time === null) {
		return day * 1440;
	}
	const [hours, minutes] = parts.time.split(':').map(Number);
	if (hours === undefined || minutes === undefined) {
		return null;
	}
	return day * 1440 + hours * 60 + minutes;
}

/** Null unless the text is a date and the shift a whole number of days: rounding half a day would be a guess. */
export function addDays(text: string, days: number): string | null {
	const parts = dateParts(text);
	const from = dayNumber(text);
	if (parts === null || from === null || !Number.isInteger(days)) {
		return null;
	}
	const civil = civilFromDays(from + days);
	// Outside four digits the written form is no longer a date this module reads: a negative
	// year cannot be padded, and a fifth digit breaks the pattern.
	if (civil.year < 0 || civil.year > 9999) {
		return null;
	}
	const date = formatDate(civil.year, civil.month, civil.day);
	return parts.time === null ? date : `${date}T${parts.time}`;
}

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
