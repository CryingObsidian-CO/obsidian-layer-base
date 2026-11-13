import { describe, expect, it } from 'vitest';
import { createEmptyDoc } from '../src/io/schema';
import { computeFormula, computeFormulaWithReader } from '../src/model/formula';
import { numberTexts } from '../src/model/numbering';
import { addRecord } from '../src/model/records';
import type { Field, LayerDoc, LayerRecord } from '../src/types';

function board(fields: Field[]): { doc: LayerDoc; recordId: string } {
	const doc = createEmptyDoc('Board');
	doc.fields = fields;
	const record = addRecord(doc);
	return { doc, recordId: record.id };
}

function formulaField(id: string, formula: string): Field {
	return { id, name: id, type: 'formula', formula };
}

function columnOf(doc: LayerDoc, id: string): Field {
	const field = doc.fields.find((candidate) => candidate.id === id);
	if (!field) {
		throw new Error(`no column ${id}`);
	}
	return field;
}

function rowOf(doc: LayerDoc): LayerRecord {
	const record = doc.records[0];
	if (!record) {
		throw new Error('the board has no row');
	}
	return record;
}

describe('a formula reading a column the document cannot answer for', () => {
	it('takes what the reader says instead of the ids a relation stores', () => {
		const { doc } = board([
			{ id: 'f_link', name: 'link', type: 'relation' },
			formulaField('f_out', '{link}'),
		]);
		rowOf(doc).cells.f_link = ['r_1', 'r_2'];
		const result = computeFormulaWithReader(
			doc,
			rowOf(doc),
			columnOf(doc, 'f_out'),
			() => 'Ann, Bob',
		);
		expect(result.ok && result.text).toBe('Ann, Bob');
	});

	it('reads a computed column that stores nothing at all', () => {
		const { doc } = board([
			{
				id: 'f_tags',
				name: 'tags',
				type: 'lookup',
				lookupSourceFieldId: 'f_link',
				lookupFieldId: 'f_name',
			},
			formulaField('f_out', '{tags}'),
		]);
		const result = computeFormulaWithReader(
			doc,
			rowOf(doc),
			columnOf(doc, 'f_out'),
			() => 'a, b',
		);
		expect(result.ok && result.text).toBe('a, b');
	});

	it('falls back to the stored cell when the reader answers nothing', () => {
		const { doc } = board([
			{ id: 'f_n', name: 'n', type: 'number' },
			formulaField('f_out', '{n} + 1'),
		]);
		rowOf(doc).cells.f_n = 3;
		const result = computeFormulaWithReader(
			doc,
			rowOf(doc),
			columnOf(doc, 'f_out'),
			() => undefined,
		);
		expect(result.ok && result.text).toBe('4');
	});

	it('adds to a total the reader hands over as a number, rather than joining it', () => {
		const { doc } = board([
			{ id: 'f_total', name: 'total', type: 'rollup' },
			formulaField('f_out', '{total} + 1'),
		]);
		const result = computeFormulaWithReader(
			doc,
			rowOf(doc),
			columnOf(doc, 'f_out'),
			(field) => (field.type === 'rollup' ? 42 : undefined),
		);
		expect(result.ok && result.text).toBe('43');
	});

	it('reads a computed column as empty without a reader, never as a row id', () => {
		const { doc } = board([
			{ id: 'f_tags', name: 'tags', type: 'lookup' },
			formulaField('f_out', '{tags}'),
		]);
		const result = computeFormula(doc, rowOf(doc), columnOf(doc, 'f_out'));
		expect(result.ok && result.text).toBe('');
	});

	it('reads a numbering column as the padded text the cell shows', () => {
		const { doc } = board([
			{ id: 'f_no', name: 'no', type: 'autoNumber', numberLength: 2 },
			formulaField('f_out', '{no}'),
		]);
		addRecord(doc);
		const texts = numberTexts(doc, columnOf(doc, 'f_no'));
		const result = computeFormulaWithReader(
			doc,
			rowOf(doc),
			columnOf(doc, 'f_out'),
			(field) =>
				field.type === 'autoNumber' ? texts.get(rowOf(doc).id) : undefined,
		);
		expect(result.ok && result.text).toBe('01');
	});
});

describe('a formula reading another formula', () => {
	it('keeps a number a number, so `+` still adds', () => {
		const { doc } = board([
			{ id: 'f_n', name: 'n', type: 'number' },
			formulaField('f_double', '{n} * 2'),
			formulaField('f_next', '{f_double} + 1'),
		]);
		rowOf(doc).cells.f_n = 5;
		const result = computeFormula(doc, rowOf(doc), columnOf(doc, 'f_next'));
		expect(result.ok && result.text).toBe('11');
	});

	it('keeps a computed yes or no a boolean', () => {
		const { doc } = board([
			{ id: 'f_n', name: 'n', type: 'number' },
			formulaField('f_yes', '{n} > 1'),
			formulaField('f_out', 'IF({f_yes}, "yes", "no")'),
		]);
		rowOf(doc).cells.f_n = 5;
		const result = computeFormula(doc, rowOf(doc), columnOf(doc, 'f_out'));
		expect(result.ok && result.text).toBe('yes');
	});
});
