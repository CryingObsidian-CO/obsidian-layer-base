import { describe, expect, it } from 'vitest';
import {
	createEmptyDoc,
	parseLayerDoc,
	serializeLayerDoc,
} from '../src/io/schema';
import {
	cellFromText,
	cellToText,
	formatCell,
	isEmptyCell,
} from '../src/model/fields';
import {
	MAX_DECIMALS,
	constrainNumber,
	formatNumber,
	isWithinBounds,
	normaliseDecimals,
	normaliseFormat,
	parseNumber,
	parseNumberIn,
	parseOptionalNumber,
	parseShownNumber,
	sanitizeNumericInput,
	shownNumber,
	storedNumber,
} from '../src/model/number';
import { addRecord, setCellValue } from '../src/model/records';
import type { Field, LayerDoc } from '../src/types';

const plain: Field = { id: 'f_n', name: 'Amount', type: 'number' };

function withSettings(settings: Partial<Field>): Field {
	return { ...plain, ...settings };
}

describe('sanitizeNumericInput', () => {
	it('keeps digits and one decimal point', () => {
		expect(sanitizeNumericInput('12.5')).toBe('12.5');
		expect(sanitizeNumericInput('1.2.3')).toBe('1.23');
	});

	it('drops anything that cannot be part of a number', () => {
		expect(sanitizeNumericInput('12abc')).toBe('12');
		expect(sanitizeNumericInput('¥1 200')).toBe('1200');
		expect(sanitizeNumericInput('1e5')).toBe('15');
	});

	it('keeps a minus sign, but only at the front', () => {
		expect(sanitizeNumericInput('-5')).toBe('-5');
		expect(sanitizeNumericInput('5-1')).toBe('51');
	});

	it('leaves a partial entry that is still being typed', () => {
		expect(sanitizeNumericInput('-')).toBe('-');
		expect(sanitizeNumericInput('.')).toBe('.');
	});

	it('empties a value with no digits left', () => {
		expect(sanitizeNumericInput('abc')).toBe('');
	});
});

describe('parseNumber', () => {
	it('reads a plain number', () => {
		expect(parseNumber('12.5')).toBe(12.5);
		expect(parseNumber('-3')).toBe(-3);
		expect(parseNumber('0')).toBe(0);
	});

	it('reads the display form of a percent cell', () => {
		expect(parseNumber('50%')).toBe(50);
		expect(parseNumber(' 50 % ')).toBe(50);
	});

	it('reads a percent sign as a hundredth when the text is a value', () => {
		expect(parseShownNumber('50%')).toBe(0.5);
		expect(parseShownNumber('50')).toBe(50);
	});

	it('counts a percent field in hundredths, whatever the sign says', () => {
		const percent: Field = { id: 'f_p', name: 'Rate', type: 'number', numberFormat: 'percent' };
		expect(parseNumberIn(percent, '100')).toBe(1);
		expect(parseNumberIn(percent, '100%')).toBe(1);
		expect(parseNumberIn(percent, '0.5')).toBe(0.005);
		expect(parseNumberIn(plain, '50%')).toBe(0.5);
		expect(parseNumberIn(plain, '50')).toBe(50);
	});

	it('treats blank as no number', () => {
		expect(parseNumber('')).toBeNull();
		expect(parseNumber('   ')).toBeNull();
	});

	it('refuses text that is not a number', () => {
		expect(parseNumber('abc')).toBeNull();
		expect(parseNumber('12abc')).toBeNull();
	});

	it('refuses infinities, which cannot be stored as JSON', () => {
		expect(parseNumber('Infinity')).toBeNull();
	});
});

describe('normaliseDecimals', () => {
	it('keeps a sensible setting', () => {
		expect(normaliseDecimals(2)).toBe(2);
	});

	it('treats missing as "as typed"', () => {
		expect(normaliseDecimals(undefined)).toBeNull();
	});

	it('clamps into the range it can render', () => {
		expect(normaliseDecimals(0)).toBe(0);
		expect(normaliseDecimals(-2)).toBe(0);
		expect(normaliseDecimals(99)).toBe(MAX_DECIMALS);
		expect(normaliseDecimals(2.6)).toBe(3);
	});
});

describe('normaliseFormat', () => {
	it('defaults to plain', () => {
		expect(normaliseFormat(undefined)).toBe('plain');
		expect(normaliseFormat('percent')).toBe('percent');
	});
});

describe('formatNumber', () => {
	it('shows a number as typed when no precision is set', () => {
		expect(formatNumber(12.5, plain)).toBe('12.5');
		expect(formatNumber(0, plain)).toBe('0');
	});

	it('pads to the set precision', () => {
		expect(formatNumber(12.5, withSettings({ decimals: 2 }))).toBe('12.50');
		expect(formatNumber(12.567, withSettings({ decimals: 1 }))).toBe('12.6');
	});

	it('shows a proportion as a percentage', () => {
		expect(formatNumber(0.5, withSettings({ numberFormat: 'percent' }))).toBe('50%');
		expect(
			formatNumber(0.125, withSettings({ numberFormat: 'percent', decimals: 1 })),
		).toBe('12.5%');
		// Multiplied back exactly: fifty per cent cannot come out as 15.000000000000002.
		expect(formatNumber(0.15, withSettings({ numberFormat: 'percent' }))).toBe('15%');
	});

	it('converts between the units it shows and the number it stores', () => {
		expect(shownNumber(0.15, 'percent')).toBe(15);
		expect(storedNumber(15, 'percent')).toBe(0.15);
		expect(shownNumber(42, 'plain')).toBe(42);
		expect(storedNumber(42, undefined)).toBe(42);
	});
});

describe('constrainNumber', () => {
	it('leaves a value inside the bounds alone', () => {
		const field = withSettings({ min: 0, max: 100 });
		expect(constrainNumber(42, field)).toBe(42);
	});

	it('pulls a value to the nearest bound', () => {
		const field = withSettings({ min: 0, max: 100 });
		expect(constrainNumber(-5, field)).toBe(0);
		expect(constrainNumber(150, field)).toBe(100);
	});

	it('applies a one-sided bound', () => {
		expect(constrainNumber(5, withSettings({ min: 10 }))).toBe(10);
		expect(constrainNumber(5, withSettings({ max: 10 }))).toBe(5);
	});

	it('rounds to the precision before bounding', () => {
		const field = withSettings({ decimals: 1, max: 1.25 });
		expect(constrainNumber(1.28, field)).toBe(1.25);
	});

	it('keeps the bounds as they are when both are absent', () => {
		expect(constrainNumber(1234.5678, plain)).toBe(1234.5678);
	});

	it('rounds to the precision when one is set', () => {
		expect(constrainNumber(12.567, withSettings({ decimals: 2 }))).toBe(12.57);
		expect(constrainNumber(12.5, withSettings({ decimals: 0 }))).toBe(13);
	});

	it('never returns a value outside the bounds', () => {
		const field = withSettings({ min: -10, max: 10, decimals: 2 });
		for (const input of [-99, -10.004, 0, 10.004, 99]) {
			expect(isWithinBounds(constrainNumber(input, field), field)).toBe(true);
		}
	});
});

describe('isWithinBounds', () => {
	it('reports what the bounds allow', () => {
		const field = withSettings({ min: 0, max: 10 });
		expect(isWithinBounds(0, field)).toBe(true);
		expect(isWithinBounds(10, field)).toBe(true);
		expect(isWithinBounds(-1, field)).toBe(false);
		expect(isWithinBounds(11, field)).toBe(false);
	});
});

describe('parseOptionalNumber', () => {
	it('reads blank as no setting, not zero', () => {
		expect(parseOptionalNumber('')).toBeNull();
		expect(parseOptionalNumber('  ')).toBeNull();
	});

	it('reads zero as a real setting', () => {
		expect(parseOptionalNumber('0')).toBe(0);
	});

	it('refuses text', () => {
		expect(parseOptionalNumber('abc')).toBeNull();
	});
});

describe('through the cell model', () => {
	it('parses text into a bounded number', () => {
		const field = withSettings({ max: 100 });
		expect(cellFromText(field, '42')).toEqual({ ok: true, value: 42 });
		expect(cellFromText(field, '150')).toEqual({ ok: true, value: 100 });
	});

	it('refuses text that is not a number', () => {
		expect(cellFromText(plain, 'abc')).toEqual({ ok: false });
	});

	it('copies out as the display text and reads back to the same number', () => {
		const field = withSettings({ numberFormat: 'percent', decimals: 1 });
		const text = cellToText(field, 0.125);
		expect(text).toBe('12.5%');
		expect(cellFromText(field, text)).toEqual({ ok: true, value: 0.125 });
	});

	it('stores what a percent cell is showing, so a bound is a proportion', () => {
		const field = withSettings({ numberFormat: 'percent', min: 0, max: 1 });
		expect(cellFromText(field, '100')).toEqual({ ok: true, value: 1 });
		expect(cellFromText(field, '200')).toEqual({ ok: true, value: 1 });
		expect(cellToText(field, 1)).toBe('100%');
	});

	it('rounds by the digits the reader sees, not the digits in the file', () => {
		const field = withSettings({ numberFormat: 'percent', decimals: 1 });
		expect(cellFromText(field, '12.5%')).toEqual({ ok: true, value: 0.125 });
		expect(cellToText(field, 0.125)).toBe('12.5%');
	});

	it('treats zero as a value and nothing as empty', () => {
		expect(isEmptyCell(0)).toBe(false);
		expect(isEmptyCell('')).toBe(true);
		expect(formatCell(plain, 0)).toBe('0');
		expect(formatCell(plain, '')).toBe('');
	});
});

describe('through the file', () => {
	function numberDoc(settings: Partial<Field>): LayerDoc {
		const doc = createEmptyDoc('Board');
		doc.fields = [{ ...plain, primary: true, ...settings }];
		return doc;
	}

	it('keeps the number as a real number, not as text', () => {
		const doc = numberDoc({});
		const record = addRecord(doc);
		record.cells.f_n = 12.5;

		const { doc: parsed } = parseLayerDoc(serializeLayerDoc(doc));
		expect(parsed.records[0]?.cells.f_n).toBe(12.5);
		const raw = JSON.parse(serializeLayerDoc(doc)) as {
			records: { cells: Record<string, unknown> }[];
		};
		expect(typeof raw.records[0]?.cells.f_n).toBe('number');
	});

	it('keeps the field settings, so a reload does not lose the format', () => {
		const doc = numberDoc({
			numberFormat: 'percent',
			decimals: 2,
			min: 0,
			max: 1,
		});
		const { doc: parsed } = parseLayerDoc(serializeLayerDoc(doc));
		const field = parsed.fields[0];
		expect(field?.type).toBe('number');
		expect(field?.numberFormat).toBe('percent');
		expect(field?.decimals).toBe(2);
		expect(field?.min).toBe(0);
		expect(field?.max).toBe(1);
	});

	it('leaves the defaults out of the file entirely', () => {
		const doc = numberDoc({});
		const raw = JSON.parse(serializeLayerDoc(doc)) as {
			fields: Record<string, unknown>[];
		};
		expect('min' in (raw.fields[0] ?? {})).toBe(false);
		expect('decimals' in (raw.fields[0] ?? {})).toBe(false);
		expect('numberFormat' in (raw.fields[0] ?? {})).toBe(false);
	});

	it('coerces a number written as text by hand, and drops what cannot parse', () => {
		const doc = numberDoc({});
		const record = addRecord(doc);
		record.cells.f_n = 1;
		const raw = JSON.parse(serializeLayerDoc(doc)) as {
			records: { cells: Record<string, unknown> }[];
		};
		raw.records[0]!.cells.f_n = '7.5';
		expect(parseLayerDoc(JSON.stringify(raw)).doc.records[0]?.cells.f_n).toBe(
			7.5,
		);

		raw.records[0]!.cells.f_n = 'seven';
		expect('f_n' in (parseLayerDoc(JSON.stringify(raw)).doc.records[0]?.cells ?? {})).toBe(
			false,
		);
	});

	it('refuses a wrong shape from the setter, but accepts one that clears', () => {
		const doc = numberDoc({});
		const record = addRecord(doc);
		expect(setCellValue(doc, record.id, doc.fields[0]!, '12')).toBe(false);
		expect(setCellValue(doc, record.id, doc.fields[0]!, 12)).toBe(true);
		expect(record.cells.f_n).toBe(12);
		expect(setCellValue(doc, record.id, doc.fields[0]!, '')).toBe(true);
		expect('f_n' in record.cells).toBe(false);
	});
});

