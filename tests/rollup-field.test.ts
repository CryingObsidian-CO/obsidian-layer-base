import { describe, expect, it } from 'vitest';
import { createEmptyDoc, parseLayerDoc, serializeLayerDoc } from '../src/io/schema';
import { isDerived } from '../src/model/fields';
import { aggregatesFor } from '../src/model/rollup';
import { addRecord, changeFieldType, duplicateField, setCellValue } from '../src/model/records';
import type { Field, LayerDoc } from '../src/types';

const rollup: Field = {
	id: 'f_total',
	name: 'Total',
	type: 'rollup',
	rollupSourceFieldId: 'f_orders',
	rollupFieldId: 'f_amount',
	rollupAggregate: 'sum',
};

function docWith(fields: Field[]): LayerDoc {
	const doc = createEmptyDoc('Board');
	doc.fields = fields;
	return doc;
}

describe('a rollup field', () => {
	it('is a derived type', () => {
		expect(isDerived('rollup')).toBe(true);
	});

	it('refuses any value written to it', () => {
		const doc = docWith([{ ...rollup, primary: true }]);
		const record = addRecord(doc);
		expect(setCellValue(doc, record.id, doc.fields[0]!, '350')).toBe(false);
		expect(record.cells.f_total).toBeUndefined();
	});

	it('keeps its three settings through a save and reload', () => {
		const doc = docWith([{ ...rollup, primary: true }]);
		const field = parseLayerDoc(serializeLayerDoc(doc)).doc.fields[0];
		expect(field?.type).toBe('rollup');
		expect(field?.rollupSourceFieldId).toBe('f_orders');
		expect(field?.rollupFieldId).toBe('f_amount');
		expect(field?.rollupAggregate).toBe('sum');
	});

	it('refuses an aggregate it does not know', () => {
		const doc = docWith([{ ...rollup, primary: true }]);
		const raw = JSON.parse(serializeLayerDoc(doc)) as {
			fields: Record<string, unknown>[];
		};
		raw.fields[0]!.rollupAggregate = 'median';
		expect(
			parseLayerDoc(JSON.stringify(raw)).doc.fields[0]?.rollupAggregate,
		).toBeUndefined();
	});

	it('leaves unset settings out of the file', () => {
		const doc = docWith([
			{ id: 'f_bare', name: 'Bare', type: 'rollup', primary: true },
		]);
		const raw = JSON.parse(serializeLayerDoc(doc)) as {
			fields: Record<string, unknown>[];
		};
		expect('rollupSourceFieldId' in (raw.fields[0] ?? {})).toBe(false);
		expect('rollupFieldId' in (raw.fields[0] ?? {})).toBe(false);
	});

	it('loses its settings when the type changes', () => {
		const doc = docWith([{ ...rollup, primary: true }]);
		changeFieldType(doc, 'f_total', 'text');
		expect(doc.fields[0]?.rollupSourceFieldId).toBeUndefined();
		expect(doc.fields[0]?.rollupFieldId).toBeUndefined();
		expect(doc.fields[0]?.rollupAggregate).toBeUndefined();
	});

	it('carries its settings to a duplicate', () => {
		const doc = docWith([{ ...rollup, primary: true }]);
		const copy = duplicateField(doc, 'f_total');
		expect(copy?.rollupSourceFieldId).toBe('f_orders');
		expect(copy?.rollupAggregate).toBe('sum');
	});
});

describe('which aggregates a column may be given', () => {
	it('offers a number column every reduction', () => {
		expect(aggregatesFor('number')).toEqual([
			'sum',
			'average',
			'min',
			'max',
			'count',
			'countAll',
		]);
	});

	it('offers a date the comparisons but not a total', () => {
		for (const type of ['date', 'datetime'] as const) {
			expect(aggregatesFor(type)).toEqual(['min', 'max', 'count', 'countAll']);
		}
	});

	it('offers text and choices only the two counts', () => {
		for (const type of ['text', 'longtext', 'select', 'multiSelect', 'checkbox'] as const) {
			expect(aggregatesFor(type)).toEqual(['count', 'countAll']);
		}
	});
});
