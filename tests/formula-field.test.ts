import { describe, expect, it } from 'vitest';
import {
	createEmptyDoc,
	normalizeCellForField,
	parseLayerDoc,
	serializeLayerDoc,
} from '../src/io/schema';
import { isDerived, isMissingRequired } from '../src/model/fields';
import { computeFormula } from '../src/model/formula';
import { addRecord, changeFieldType, setCellValue } from '../src/model/records';
import type { Field, LayerDoc } from '../src/types';

const formulaField: Field = {
	id: 'f_calc',
	name: 'Total',
	type: 'formula',
	formula: '{a} * 2',
};

function docWith(fields: Field[]): LayerDoc {
	const doc = createEmptyDoc('Board');
	doc.fields = fields;
	return doc;
}

describe('a formula field', () => {
	it('is a derived type', () => {
		expect(isDerived('formula')).toBe(true);
		expect(isMissingRequired({ ...formulaField, required: true }, '')).toBe(false);
	});

	it('refuses any value written to it', () => {
		const doc = docWith([{ ...formulaField, primary: true }]);
		const record = addRecord(doc);
		expect(setCellValue(doc, record.id, doc.fields[0]!, '42')).toBe(false);
		expect(setCellValue(doc, record.id, doc.fields[0]!, 42)).toBe(false);
		expect(record.cells.f_calc).toBeUndefined();
	});

	it('drops a value written by hand in the file', () => {
		expect(normalizeCellForField('stale', 'formula')).toBe('');
	});

	it('keeps its expression through a save and reload', () => {
		const doc = docWith([{ ...formulaField, primary: true }]);
		const { doc: parsed } = parseLayerDoc(serializeLayerDoc(doc));
		const field = parsed.fields[0];
		expect(field?.type).toBe('formula');
		expect(field?.formula).toBe('{a} * 2');
	});

	it('keeps no expression when the field stops being a formula', () => {
		const doc = docWith([{ ...formulaField, primary: true }]);
		changeFieldType(doc, 'f_calc', 'text');
		expect(doc.fields[0]?.formula).toBeUndefined();
	});

	it('leaves the expression out of the file when it is empty', () => {
		const doc = docWith([
			{ id: 'f_e', name: 'Empty', type: 'formula', primary: true },
		]);
		const raw = JSON.parse(serializeLayerDoc(doc)) as {
			fields: Record<string, unknown>[];
		};
		expect('formula' in (raw.fields[0] ?? {})).toBe(false);
	});
});

describe('the declared result type', () => {
	it('survives a save and reload', () => {
		const doc = docWith([
			{ ...formulaField, formulaType: 'number', primary: true },
		]);
		const { doc: parsed } = parseLayerDoc(serializeLayerDoc(doc));
		expect(parsed.fields[0]?.formulaType).toBe('number');
	});

	it('is left out of the file when it only follows the result', () => {
		const doc = docWith([{ ...formulaField, primary: true }]);
		const raw = JSON.parse(serializeLayerDoc(doc)) as {
			fields: Record<string, unknown>[];
		};
		expect('formulaType' in (raw.fields[0] ?? {})).toBe(false);
	});

	it('refuses a value that is not one of the three', () => {
		const doc = docWith([{ ...formulaField, primary: true }]);
		const raw = JSON.parse(serializeLayerDoc(doc)) as {
			fields: Record<string, unknown>[];
		};
		raw.fields[0]!.formulaType = 'nonsense';
		expect(
			parseLayerDoc(JSON.stringify(raw)).doc.fields[0]?.formulaType,
		).toBeUndefined();
	});

	it('goes away with the expression when the type changes', () => {
		const doc = docWith([
			{ ...formulaField, formulaType: 'boolean', primary: true },
		]);
		changeFieldType(doc, 'f_calc', 'text');
		expect(doc.fields[0]?.formulaType).toBeUndefined();
	});

	it('never changes what the formula computed', () => {
		const doc = docWith([
			{ id: 'f_n', name: 'n', type: 'number' },
			{
				id: 'f_calc',
				name: 'calc',
				type: 'formula',
				formula: '{n} + 1',
				formulaType: 'text',
				primary: true,
			},
		]);
		const record = addRecord(doc);
		record.cells.f_n = 41;
		const result = computeFormula(doc, record, doc.fields[1]!);
		expect(result.ok && result.text).toBe('42');
		expect(result.ok && result.kind).toBe('number');
	});
});

describe('a column with no expression yet', () => {
	it('is reported by the engine as empty, not as a crash', () => {
		const doc = docWith([
			{ id: 'f_blank', name: 'Blank', type: 'formula', primary: true },
		]);
		const record = addRecord(doc);
		const result = computeFormula(doc, record, doc.fields[0]!);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('empty');
		}
	});

	it('treats whitespace the same way', () => {
		const doc = docWith([
			{ id: 'f_ws', name: 'Ws', type: 'formula', formula: '   ', primary: true },
		]);
		const record = addRecord(doc);
		expect(computeFormula(doc, record, doc.fields[0]!).ok).toBe(false);
	});
});
