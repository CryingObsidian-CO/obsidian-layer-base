import { describe, expect, it } from 'vitest';
import { padNumber } from '../src/model/auto-number';
import { numberTexts } from '../src/model/numbering';
import { addRecord, addRecordAtTop, setCellValue } from '../src/model/records';
import { createEmptyDoc, parseLayerDoc, serializeLayerDoc } from '../src/io/schema';
import type { Field, LayerDoc } from '../src/types';

/** A table whose rows are numbered, optionally grouped by another column. */
function board(fields: Field[]): LayerDoc {
	const doc = createEmptyDoc('Board');
	doc.fields = fields.map((field) => ({ ...field }));
	return doc;
}

const serial: Field = { id: 'f_no', name: 'No', type: 'autoNumber', numberLength: 2 };

const grouped: Field = {
	id: 'f_no',
	name: 'No',
	type: 'autoNumber',
	numberLength: 2,
	numberGroupFieldId: 'f_group',
};

const groupColumn: Field = { id: 'f_group', name: 'Group', type: 'text' };

/** What every row reads in that column, top to bottom. */
function numbers(doc: LayerDoc, field: Field): string[] {
	const texts = numberTexts(doc, field);
	return doc.records.map((record) => texts.get(record.id) ?? '—');
}

describe('padding', () => {
	it('pads to the configured width', () => {
		expect(padNumber(1, 3)).toBe('001');
		expect(padNumber(42, 3)).toBe('042');
		expect(padNumber(7, 1)).toBe('7');
	});

	it('treats the width as a minimum, not a limit', () => {
		expect(padNumber(1000, 3)).toBe('1000');
	});
});

describe('a table with one sequence', () => {
	it('counts the rows in order', () => {
		const doc = board([serial]);
		addRecord(doc);
		addRecord(doc);
		addRecord(doc);
		expect(numbers(doc, serial)).toEqual(['01', '02', '03']);
	});

	it('writes nothing down: the cells stay empty', () => {
		const doc = board([serial]);
		const record = addRecord(doc);
		expect(record.cells[serial.id]).toBeUndefined();
		expect(record.cells).toEqual({});
	});

	it('closes the gap when a row is removed, without renumbering anybody', () => {
		const doc = board([serial]);
		addRecord(doc);
		addRecord(doc);
		addRecord(doc);
		doc.records.splice(1, 1);
		expect(numbers(doc, serial)).toEqual(['01', '02']);
	});

	it('shifts the rows after an insertion', () => {
		const doc = board([serial]);
		addRecord(doc);
		addRecord(doc);
		addRecordAtTop(doc);
		expect(numbers(doc, serial)).toEqual(['01', '02', '03']);
		expect(doc.records[0]?.cells[serial.id]).toBeUndefined();
	});
});

describe('a table numbered within a group', () => {
	it('counts each group from one, in stored order', () => {
		const doc = board([groupColumn, grouped]);
		const first = addRecord(doc);
		const second = addRecord(doc);
		const third = addRecord(doc);
		setCellValue(doc, first.id, groupColumn, 'A');
		setCellValue(doc, second.id, groupColumn, 'B');
		setCellValue(doc, third.id, groupColumn, 'A');
		expect(numbers(doc, grouped)).toEqual(['01', '01', '02']);
	});

	it('counts a row with no group on its own', () => {
		const doc = board([groupColumn, grouped]);
		addRecord(doc);
		const grouped1 = addRecord(doc);
		addRecord(doc);
		setCellValue(doc, grouped1.id, groupColumn, 'A');
		expect(numbers(doc, grouped)).toEqual(['01', '01', '02']);
	});

	it('renumbers both groups when a row changes group', () => {
		const doc = board([groupColumn, grouped]);
		const first = addRecord(doc);
		const second = addRecord(doc);
		setCellValue(doc, first.id, groupColumn, 'A');
		setCellValue(doc, second.id, groupColumn, 'A');
		expect(numbers(doc, grouped)).toEqual(['01', '02']);

		setCellValue(doc, first.id, groupColumn, 'B');
		expect(numbers(doc, grouped)).toEqual(['01', '01']);
	});

	it('counts by what the group column shows, not by the id it stores', () => {
		const doc = board([
			{
				id: 'f_group',
				name: 'Group',
				type: 'select',
				options: [
					{ id: 'o_a', name: 'A', color: 'blue' },
					{ id: 'o_b', name: 'B', color: 'green' },
				],
			},
			grouped,
		]);
		const first = addRecord(doc);
		const second = addRecord(doc);
		const group = doc.fields[0]!;
		setCellValue(doc, first.id, group, 'o_a');
		setCellValue(doc, second.id, group, 'o_a');
		expect(numbers(doc, grouped)).toEqual(['01', '02']);
	});
});

describe('what a numbering column is', () => {
	it('refuses a value written into it', () => {
		const doc = board([serial]);
		const record = addRecord(doc);
		expect(setCellValue(doc, record.id, serial, 5)).toBe(false);
		expect(record.cells[serial.id]).toBeUndefined();
	});

	it('drops a number an older file wrote down', () => {
		const doc = board([serial]);
		const record = addRecord(doc);
		// What the previous version stored, written straight into the document.
		record.cells[serial.id] = 7;
		const { doc: parsed } = parseLayerDoc(serializeLayerDoc(doc));
		expect(parsed.records[0]?.cells[serial.id]).toBeUndefined();
		expect(numbers(parsed, serial)).toEqual(['01']);
	});
});
