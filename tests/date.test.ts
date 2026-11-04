import { describe, expect, it } from 'vitest';
import {
	createEmptyDoc,
	parseLayerDoc,
	serializeLayerDoc,
} from '../src/io/schema';
import {
	addDays,
	dateField as partOfDate,
	dateMinutes,
	dateParts,
	dayNumber,
	daysInMonth,
	displayDateTime,
	isLeapYear,
	normaliseDate,
	normaliseDateTime,
} from '../src/model/date';
import {
	cellFromText,
	cellToText,
	formatCell,
	isEmptyCell,
} from '../src/model/fields';
import { addRecord, setCellValue } from '../src/model/records';
import type { Field, LayerDoc } from '../src/types';

const dateField: Field = { id: 'f_d', name: 'Due', type: 'date' };
const momentField: Field = { id: 'f_dt', name: 'At', type: 'datetime' };

describe('calendar arithmetic', () => {
	it('knows leap years, including the century rule', () => {
		expect(isLeapYear(2024)).toBe(true);
		expect(isLeapYear(2023)).toBe(false);
		expect(isLeapYear(1900)).toBe(false);
		expect(isLeapYear(2000)).toBe(true);
	});

	it('gives the length of each month', () => {
		expect(daysInMonth(2024, 2)).toBe(29);
		expect(daysInMonth(2023, 2)).toBe(28);
		expect(daysInMonth(2023, 1)).toBe(31);
		expect(daysInMonth(2023, 4)).toBe(30);
		expect(daysInMonth(2023, 12)).toBe(31);
	});
});

describe('normaliseDate', () => {
	it('keeps a canonical date', () => {
		expect(normaliseDate('2026-10-17')).toBe('2026-10-17');
	});

	it('pads a single-digit month and day', () => {
		expect(normaliseDate('2026-1-5')).toBe('2026-01-05');
	});

	it('accepts a slash separator', () => {
		expect(normaliseDate('2026/10/17')).toBe('2026-10-17');
	});

	it('trims surrounding space', () => {
		expect(normaliseDate('  2026-10-17 ')).toBe('2026-10-17');
	});

	it('refuses a day the month does not have', () => {
		expect(normaliseDate('2026-02-30')).toBeNull();
		expect(normaliseDate('2023-02-29')).toBeNull();
	});

	it('accepts February 29 in a leap year', () => {
		expect(normaliseDate('2024-02-29')).toBe('2024-02-29');
	});

	it('refuses months and days out of range', () => {
		expect(normaliseDate('2026-00-10')).toBeNull();
		expect(normaliseDate('2026-13-10')).toBeNull();
		expect(normaliseDate('2026-10-00')).toBeNull();
		expect(normaliseDate('2026-10-32')).toBeNull();
	});

	it('refuses a month-first form rather than guessing the order', () => {
		expect(normaliseDate('10/17/2026')).toBeNull();
		expect(normaliseDate('17/10/2026')).toBeNull();
	});

	it('refuses things that are not dates', () => {
		expect(normaliseDate('')).toBeNull();
		expect(normaliseDate('tomorrow')).toBeNull();
		expect(normaliseDate('2026-10')).toBeNull();
		expect(normaliseDate('2026-10-17T20:00')).toBeNull();
	});
});

describe('normaliseDateTime', () => {
	it('reads the stored form', () => {
		expect(normaliseDateTime('2026-10-17T20:17')).toBe('2026-10-17T20:17');
	});

	it('accepts the display form, which uses a space', () => {
		expect(normaliseDateTime('2026-10-17 20:17')).toBe('2026-10-17T20:17');
	});

	it('pads hours and minutes', () => {
		expect(normaliseDateTime('2026-10-17T9:5')).toBe('2026-10-17T09:05');
	});

	it('drops seconds', () => {
		expect(normaliseDateTime('2026-10-17T20:17:45')).toBe('2026-10-17T20:17');
	});

	it('refuses hours and minutes out of range', () => {
		expect(normaliseDateTime('2026-10-17T24:00')).toBeNull();
		expect(normaliseDateTime('2026-10-17T20:60')).toBeNull();
	});

	it('refuses a value carrying a zone instead of converting it', () => {
		expect(normaliseDateTime('2026-10-17T20:17Z')).toBeNull();
		expect(normaliseDateTime('2026-10-17T20:17+08:00')).toBeNull();
	});

	it('refuses a date with no time, which belongs to the other type', () => {
		expect(normaliseDateTime('2026-10-17')).toBeNull();
	});

	it('refuses a bad date even with a good time', () => {
		expect(normaliseDateTime('2026-02-30T20:17')).toBeNull();
	});
});

describe('displayDateTime', () => {
	it('puts a space where the stored form keeps its T', () => {
		expect(displayDateTime('2026-10-17T20:17')).toBe('2026-10-17 20:17');
	});

	it('leaves a value with no T alone', () => {
		expect(displayDateTime('2026-10-17')).toBe('2026-10-17');
	});
});

describe('through the cell model', () => {
	it('parses text into the canonical stored form', () => {
		expect(cellFromText(dateField, '2026/1/5')).toEqual({
			ok: true,
			value: '2026-01-05',
		});
		expect(cellFromText(momentField, '2026-10-17 20:17')).toEqual({
			ok: true,
			value: '2026-10-17T20:17',
		});
	});

	it('refuses text that is not a date', () => {
		expect(cellFromText(dateField, 'tomorrow')).toEqual({ ok: false });
		expect(cellFromText(momentField, '2026-10-17')).toEqual({ ok: false });
	});

	it('reads blank as an empty cell', () => {
		expect(cellFromText(dateField, '  ')).toEqual({ ok: true, value: '' });
		expect(cellFromText(momentField, '  ')).toEqual({ ok: true, value: '' });
	});

	it('copies out display text that parses back to the same value', () => {
		const shown = cellToText(momentField, '2026-10-17T20:17');
		expect(shown).toBe('2026-10-17 20:17');
		expect(cellFromText(momentField, shown)).toEqual({
			ok: true,
			value: '2026-10-17T20:17',
		});
	});

	it('shows a date as stored and a date-time with a space', () => {
		expect(formatCell(dateField, '2026-10-17')).toBe('2026-10-17');
		expect(formatCell(momentField, '2026-10-17T20:17')).toBe(
			'2026-10-17 20:17',
		);
		expect(formatCell(dateField, '')).toBe('');
		expect(isEmptyCell('')).toBe(true);
	});
});

describe('through the file', () => {
	function dateDoc(): LayerDoc {
		const doc = createEmptyDoc('Board');
		doc.fields = [
			{ ...dateField, primary: true },
			{ ...momentField },
		];
		return doc;
	}

	it('keeps both values as written', () => {
		const doc = dateDoc();
		const record = addRecord(doc);
		record.cells.f_d = '2026-10-17';
		record.cells.f_dt = '2026-10-17T20:17';

		const { doc: parsed } = parseLayerDoc(serializeLayerDoc(doc));
		expect(parsed.records[0]?.cells.f_d).toBe('2026-10-17');
		expect(parsed.records[0]?.cells.f_dt).toBe('2026-10-17T20:17');
	});

	it('normalises what a hand-edited file holds, and drops what is not a date', () => {
		const doc = dateDoc();
		const record = addRecord(doc);
		record.cells.f_d = '2026-10-17';
		const raw = JSON.parse(serializeLayerDoc(doc)) as {
			records: { cells: Record<string, unknown> }[];
		};
		const cells = raw.records[0]!.cells;

		cells.f_d = '2026/1/5';
		expect(parseLayerDoc(JSON.stringify(raw)).doc.records[0]?.cells.f_d).toBe(
			'2026-01-05',
		);

		cells.f_d = '2026-02-30';
		expect(
			'f_d' in (parseLayerDoc(JSON.stringify(raw)).doc.records[0]?.cells ?? {}),
		).toBe(false);
	});

	it('takes a string value and refuses a number', () => {
		const doc = dateDoc();
		const record = addRecord(doc);
		const field = doc.fields[0]!;
		expect(setCellValue(doc, record.id, field, 20261017)).toBe(false);
		expect(setCellValue(doc, record.id, field, '2026-10-17')).toBe(true);
		expect(record.cells.f_d).toBe('2026-10-17');
	});
});

describe('day arithmetic without a clock', () => {
	it('counts whole days between dates', () => {
		expect(dayNumber('1970-01-01')).toBe(0);
		expect(dayNumber('1970-01-02')).toBe(1);
		expect(dayNumber('2026-10-18')! - dayNumber('2026-10-01')!).toBe(17);
	});

	it('counts across a leap day rather than skipping it', () => {
		expect(dayNumber('2028-03-01')! - dayNumber('2028-02-28')!).toBe(2);
		// 2100 is not a leap year, which the every-fourth-year rule alone would miss.
		expect(dayNumber('2100-03-01')! - dayNumber('2100-02-28')!).toBe(1);
	});

	it('does not shift with a daylight-saving change', () => {
		// The reason this does not use Date: a local-zone count would answer 0 or 2
		// on the days the clocks move, depending on where the reader lives.
		expect(dayNumber('2026-03-29')! - dayNumber('2026-03-28')!).toBe(1);
		expect(dayNumber('2026-10-25')! - dayNumber('2026-10-24')!).toBe(1);
	});

	it('moves a date by whole days', () => {
		expect(addDays('2026-12-25', 14)).toBe('2027-01-08');
		expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
		expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
	});

	it('keeps the time half of a date-time', () => {
		expect(addDays('2026-10-18T09:15', 1)).toBe('2026-10-19T09:15');
	});

	it('refuses what is not a date, rather than guessing', () => {
		expect(dayNumber('soon')).toBeNull();
		expect(dayNumber('2026-02-30')).toBeNull();
		expect(addDays('soon', 1)).toBeNull();
		// Half a day has no meaning in a column of dates.
		expect(addDays('2026-10-18', 1.5)).toBeNull();
	});

	it('reads the parts of a stored date', () => {
		expect(partOfDate('2026-03-07', 'year')).toBe(2026);
		expect(partOfDate('2026-03-07', 'month')).toBe(3);
		expect(partOfDate('2026-03-07', 'day')).toBe(7);
		expect(partOfDate('2026-03-07T22:00', 'day')).toBe(7);
		expect(partOfDate('soon', 'year')).toBeNull();
	});

	it('splits a date-time into its two halves', () => {
		expect(dateParts('2026-03-07')).toEqual({date: '2026-03-07', time: null});
		expect(dateParts('2026-03-07T08:05')).toEqual({
			date: '2026-03-07',
			time: '08:05',
		});
		expect(dateParts('soon')).toBeNull();
	});
});

describe('a date as a number to compare by', () => {
	it('counts a date-only value as the start of its day', () => {
		expect(dateMinutes('2026-10-18')).toBe(29871360);
		expect(dateMinutes('2026-10-18T00:00')).toBe(29871360);
	});

	it('keeps the time of day, and drops the seconds', () => {
		expect(dateMinutes('2026-10-18T23:00')).toBe(29872740);
		// The space form is how a date-time reads on screen; the same value either way.
		expect(dateMinutes('2026-10-18 23:00')).toBe(29872740);
		// The format stores minutes, so 23:00:59 is the minute 23:00.
		expect(dateMinutes('2026-10-18T23:00:59')).toBe(29872740);
	});

	it('keeps a later day after an earlier one however the time is written', () => {
		expect(dateMinutes('2026-10-19')).toBeGreaterThan(
			dateMinutes('2026-10-18T23:59') ?? 0,
		);
	});

	it('gives no number to a value it cannot read as a date', () => {
		/*
		 * A made-up count is worse than none: it would place the value among real
		 * dates and nothing would look wrong. These are refused by the editor, the
		 * loader and the formula engine too, so sorting has to refuse them as well.
		 */
		for (const text of [
			'2024-99-99T48:00',
			'2026-13-01',
			'2026-02-30',
			'2023-02-29',
			'2026-10-18T',
			// A zone is refused rather than converted: this format has none.
			'2026-10-18T23:00+08:00',
			'2026-10-18T23:00Z',
			'abc',
			'',
		]) {
			expect({ text, minutes: dateMinutes(text) }).toEqual({ text, minutes: null });
		}
	});
});