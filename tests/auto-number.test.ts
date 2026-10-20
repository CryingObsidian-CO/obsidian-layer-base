import { describe, expect, it } from 'vitest';
import { padNumber, numberText, nextNumber } from '../src/model/auto-number';
import {
	addRecord,
	backfillNumbers,
	changeFieldType,
	renumberAll,
	setCellValue,
} from '../src/model/records';
import { createEmptyDoc, parseLayerDoc, serializeLayerDoc } from '../src/io/schema';
import { formatCell } from '../src/model/fields';
import type { Field, LayerDoc } from '../src/types';

/** A table whose rows are numbered, optionally grouped by a text column. */
function board(fields: Field[]): LayerDoc {
	const doc = createEmptyDoc('Board');
	// Copied, because a test that changes a column's type mutates the field it is
	// given, and these fixtures are shared between cases.
	doc.fields = fields.map((field) => ({ ...field }));
	return doc;
}

const serial: Field = {
	id: 'f_no',
	name: 'No',
	type: 'autoNumber',
	numberLength: 2,
};

const grouped: Field = {
	id: 'f_no',
	name: 'No',
	type: 'autoNumber',
	numberLength: 2,
	numberGroupFieldId: 'f_group',
};

const groupColumn: Field = { id: 'f_group', name: 'Group', type: 'text' };

/** The padded number a row carries, or '—'. */
function numberAt(doc: LayerDoc, field: Field, index: number): string {
	const record = doc.records[index];
	if (!record) {
		return '—';
	}
	const text = numberText(field, record.cells[field.id] ?? '');
	return text === '' ? '—' : text;
}

describe('writing a number', () => {
	it('pads to the configured width', () => {
		expect(padNumber(1, 3)).toBe('001');
		expect(padNumber(42, 3)).toBe('042');
		expect(padNumber(7, 1)).toBe('7');
	});

	it('treats the width as a minimum, not a limit', () => {
		expect(padNumber(1000, 3)).toBe('1000');
	});

	it('hands out one past the highest, not one past the count', () => {
		expect(nextNumber([])).toBe(1);
		expect(nextNumber([1, 2, 3])).toBe(4);
		expect(nextNumber([1, 3])).toBe(4);
	});
});

describe('a table with one sequence', () => {
	it('numbers each new row in turn', () => {
		const doc = board([serial]);
		addRecord(doc);
		addRecord(doc);
		addRecord(doc);
		expect([0, 1, 2].map((index) => numberAt(doc, serial, index))).toEqual([
			'01',
			'02',
			'03',
		]);
	});

	it('gives a row inserted above a higher number, not the first one', () => {
		// The order of rows is presentation; the numbers were already issued.
		const doc = board([serial]);
		addRecord(doc);
		addRecord(doc);
		const first = doc.records[0]!;
		const later = addRecord(doc);
		expect(later.cells.f_no).toBe(3);
		expect(first.cells.f_no).toBe(1);
	});

	it('leaves a gap when a row is deleted', () => {
		const doc = board([serial]);
		addRecord(doc);
		addRecord(doc);
		addRecord(doc);
		doc.records.splice(1, 1);
		const next = addRecord(doc);
		expect(next.cells.f_no).toBe(4);
	});

	it('fills in rows that have no number yet, in row order', () => {
		const doc = board([serial]);
		addRecord(doc);
		addRecord(doc);
		// Simulate a file written before the column existed.
		for (const record of doc.records) {
			delete record.cells.f_no;
		}
		backfillNumbers(doc, serial);
		expect([0, 1].map((index) => numberAt(doc, serial, index))).toEqual([
			'01',
			'02',
		]);
	});
});

describe('a table numbered per group', () => {
	/** Adds a row and puts it in a group. */
	function rowIn(doc: LayerDoc, group: string): void {
		const record = addRecord(doc);
		setCellValue(doc, record.id, groupColumn, group);
	}

	it('counts each group on its own', () => {
		const doc = board([groupColumn, grouped]);
		rowIn(doc, 'COL');
		rowIn(doc, 'COL');
		rowIn(doc, 'AAA');
		rowIn(doc, 'COL');
		expect([0, 1, 2, 3].map((index) => numberAt(doc, grouped, index))).toEqual([
			'01',
			'02',
			'01',
			'03',
		]);
	});

	it('gives a row moved to another group that group\'s next number', () => {
		const doc = board([groupColumn, grouped]);
		rowIn(doc, 'COL');
		rowIn(doc, 'COL');
		rowIn(doc, 'AAA');
		const moved = doc.records[1]!;
		setCellValue(doc, moved.id, groupColumn, 'AAA');
		expect(moved.cells.f_no).toBe(2);
		// The row left behind keeps what it was given.
		expect(doc.records[0]!.cells.f_no).toBe(1);
	});

	it('renumbers everything when the grouping is changed', () => {
		const doc = board([groupColumn, grouped]);
		rowIn(doc, 'COL');
		rowIn(doc, 'COL');
		rowIn(doc, 'AAA');
		const ungrouped: Field = { ...grouped, numberGroupFieldId: undefined };
		delete ungrouped.numberGroupFieldId;
		renumberAll(doc, ungrouped);
		expect([0, 1, 2].map((index) => numberAt(doc, ungrouped, index))).toEqual([
			'01',
			'02',
			'03',
		]);
	});
});

describe('an auto number column', () => {
	it('is not derived, because it stores what it hands out', () => {
		const doc = board([serial]);
		const record = addRecord(doc);
		expect(record.cells.f_no).toBe(1);
	});

	it('refuses a value typed by hand', () => {
		const doc = board([serial]);
		const record = addRecord(doc);
		expect(setCellValue(doc, record.id, serial, 99)).toBe(true);
		// A number is accepted as a number, but never as text.
		expect(setCellValue(doc, record.id, serial, '99')).toBe(false);
	});

	it('keeps its settings through a save and reload', () => {
		const doc = board([groupColumn, grouped]);
		const parsed = parseLayerDoc(serializeLayerDoc(doc)).doc;
		const field = parsed.fields.find((candidate) => candidate.id === 'f_no');
		expect(field?.numberLength).toBe(2);
		expect(field?.numberGroupFieldId).toBe('f_group');
	});

	it('drops its settings when the type changes', () => {
		const doc = board([groupColumn, grouped]);
		changeFieldType(doc, 'f_no', 'text');
		expect(doc.fields[1]?.numberLength).toBeUndefined();
		expect(doc.fields[1]?.numberGroupFieldId).toBeUndefined();
	});
});

describe('what the grid is given to draw', () => {
	/*
	 * These two are the bugs this column shipped with: `formatCell` answered an
	 * empty string for a stored number, so every cell was blank until the file was
	 * reloaded — and the reload turned the number into text, which lost the padding.
	 */
	it('reads a stored number as the padded text', () => {
		expect(formatCell(serial, 1)).toBe('01');
		expect(formatCell(serial, 42)).toBe('42');
	});

	it('reads a numeric string the same way, so a reload changes nothing', () => {
		expect(formatCell(serial, '1')).toBe('01');
		expect(formatCell(serial, '42')).toBe('42');
	});

	it('keeps the number a number when the file is read back', () => {
		const doc = board([serial]);
		addRecord(doc);
		const reloaded = parseLayerDoc(serializeLayerDoc(doc)).doc;
		const value = reloaded.records[0]?.cells.f_no;
		expect(typeof value).toBe('number');
		expect(formatCell(reloaded.fields[0]!, value ?? '')).toBe('01');
	});
});
describe('numbering again in a given order', () => {
	it('numbers by the order it is handed, not by the stored order', () => {
		/*
		 * What the renumber button means: after sorting a table, the numbers should
		 * follow what is on screen, not the order the rows were entered in.
		 */
		const doc = board([serial]);
		addRecord(doc);
		addRecord(doc);
		addRecord(doc);
		// Reverse it, as a descending sort would show it.
		const shown = [...doc.records].reverse();
		renumberAll(doc, serial, shown);
		expect(shown.map((record) => record.cells.f_no)).toEqual([1, 2, 3]);
	});

	it('numbers by the stored order when no order is given', () => {
		const doc = board([serial]);
		addRecord(doc);
		addRecord(doc);
		renumberAll(doc, serial);
		expect(doc.records.map((record) => record.cells.f_no)).toEqual([1, 2]);
	});

	it('closes the gaps a deletion left', () => {
		const doc = board([serial]);
		addRecord(doc);
		addRecord(doc);
		addRecord(doc);
		doc.records.splice(1, 1);
		expect(doc.records.map((record) => record.cells.f_no)).toEqual([1, 3]);
		renumberAll(doc, serial);
		expect(doc.records.map((record) => record.cells.f_no)).toEqual([1, 2]);
	});

	it('starts each group again, as the ordinary issuing does', () => {
		const doc = board([groupColumn, grouped]);
		const a = addRecord(doc);
		setCellValue(doc, a.id, groupColumn, 'COL');
		const b = addRecord(doc);
		setCellValue(doc, b.id, groupColumn, 'AAA');
		const c = addRecord(doc);
		setCellValue(doc, c.id, groupColumn, 'COL');
		renumberAll(doc, grouped);
		expect([a, b, c].map((record) => record.cells.f_no)).toEqual([1, 1, 2]);
	});
});
describe('the fixtures themselves', () => {
	it('gives each board its own copy of a column', () => {
		/*
		 * A column object handed to a board is mutated by changing its type, and
		 * these fixtures are shared between cases. Without the copy, one case that
		 * clears a setting leaves every later case running against a column that no
		 * longer has it — which is exactly how this suite once failed while every
		 * case passed on its own.
		 */
		const first = board([grouped]);
		const second = board([grouped]);
		expect(first.fields[0]).not.toBe(second.fields[0]);
		expect(grouped.numberGroupFieldId).toBe('f_group');
	});
});