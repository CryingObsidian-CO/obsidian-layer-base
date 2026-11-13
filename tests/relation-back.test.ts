import { describe, expect, it } from 'vitest';
import {
	createEmptyDoc,
	normalizeCellForField,
	parseLayerDoc,
	serializeLayerDoc,
} from '../src/io/schema';
import { isDerived, isMissingRequired } from '../src/model/fields';
import {
	relationBackIndex,
	relationBackText,
	repairRelationPaths,
} from '../src/model/relation';
import { addRecord, setCellValue } from '../src/model/records';
import type { Field, LayerDoc } from '../src/types';

function sourceTable(): LayerDoc {
	const doc = createEmptyDoc('Tasks');
	doc.fields = [
		{ id: 'f_title', name: 'Task', type: 'text', primary: true },
		{ id: 'f_link', name: 'Project', type: 'relation', linkFieldId: 'f_title' },
	];
	doc.records = [
		{
			id: 'r_one',
			created: '2026-01-01T00:00:00.000Z',
			cells: { f_title: 'Write it', f_link: ['r_p1'] },
		},
		{
			id: 'r_two',
			created: '2026-01-01T00:00:00.000Z',
			cells: { f_title: 'Review it', f_link: ['r_p1', 'r_p2'] },
		},
		{
			id: 'r_three',
			created: '2026-01-01T00:00:00.000Z',
			cells: { f_title: 'Nothing linked', f_link: [] },
		},
	];
	return doc;
}

const backField: Field = {
	id: 'f_back',
	name: 'Linked tasks',
	type: 'relationBack',
	backFieldId: 'f_link',
};

describe('relationBackText', () => {
	it('falls back to row numbers when no display column is chosen', () => {
		expect(relationBackText(sourceTable(), 'f_link', 'r_p1')).toEqual({
			texts: ['1', '2'],
			broken: 0,
		});
	});

	it('names the rows by the chosen display column', () => {
		expect(
			relationBackText(sourceTable(), 'f_link', 'r_p1', 'f_title'),
		).toEqual({
			texts: ['Write it', 'Review it'],
			broken: 0,
		});
	});

	it('reads a row nobody points at as empty, not as broken', () => {
		expect(relationBackText(sourceTable(), 'f_link', 'r_p9')).toEqual({
			texts: [],
			broken: 0,
		});
	});

	it('reports a missing source table as broken', () => {
		expect(relationBackText(null, 'f_link', 'r_p1')).toEqual({
			texts: [],
			broken: 1,
		});
	});

	it('reports a source column that is gone as broken', () => {
		expect(relationBackText(sourceTable(), 'f_gone', 'r_p1')).toEqual({
			texts: [],
			broken: 1,
		});
	});

	it('refuses a source column that is not a relation', () => {
		expect(relationBackText(sourceTable(), 'f_title', 'r_p1')).toEqual({
			texts: [],
			broken: 1,
		});
	});
});

describe('relationBackIndex', () => {
	it('answers every row from one pass over the source', () => {
		const index = relationBackIndex(sourceTable(), 'f_link', 'f_title');
		expect(index?.get('r_p1')).toEqual(['Write it', 'Review it']);
		expect(index?.get('r_p2')).toEqual(['Review it']);
		expect(index?.has('r_p9')).toBe(false);
	});

	it('answers null when the question cannot be asked at all', () => {
		// Told apart from an empty map, which means nobody points anywhere.
		expect(relationBackIndex(sourceTable(), 'f_gone', 'f_title')).toBeNull();
		expect(relationBackIndex(sourceTable(), 'f_title', 'f_title')).toBeNull();
	});

	it('skips a row whose relation cell is empty', () => {
		const index = relationBackIndex(sourceTable(), 'f_link', 'f_title');
		expect([...(index?.values() ?? [])].flat()).not.toContain('Nothing linked');
	});

	it('never names a row by a column that reads as raw ids', () => {
		// The primary field here is a relation column whose text form is the ids it holds, which must not reach a backlink list.
		const doc = sourceTable();
		doc.fields[0]!.primary = false;
		doc.fields[1]!.primary = true;
		const index = relationBackIndex(doc, 'f_link', 'f_title');
		const names = [...(index?.values() ?? [])].flat();
		expect(names.every((name) => !name.includes('r_'))).toBe(true);
	});
});

describe('a derived field', () => {
	it('is marked as derived, and never as missing', () => {
		expect(isDerived('relationBack')).toBe(true);
		expect(isDerived('relation')).toBe(false);
		expect(isMissingRequired({ ...backField, required: true }, '')).toBe(false);
	});

	it('refuses any value written to it', () => {
		const doc = createEmptyDoc('Board');
		doc.fields = [{ ...backField, primary: true }];
		const record = addRecord(doc);
		expect(setCellValue(doc, record.id, doc.fields[0]!, ['r_one'])).toBe(false);
		expect(setCellValue(doc, record.id, doc.fields[0]!, '')).toBe(false);
		expect(record.cells.f_back).toBeUndefined();
	});

	it('drops a value written by hand instead of keeping a stale one', () => {
		expect(normalizeCellForField(['r_one'], 'relationBack')).toBe('');
	});
});

describe('through the file', () => {
	it('stores the source table and column', () => {
		const doc = createEmptyDoc('Projects');
		doc.fields = [{ ...backField, backPath: '任务/任务表.layer', primary: true }];
		const { doc: parsed } = parseLayerDoc(serializeLayerDoc(doc));
		const field = parsed.fields[0];
		expect(field?.type).toBe('relationBack');
		expect(field?.backPath).toBe('任务/任务表.layer');
		expect(field?.backFieldId).toBe('f_link');
	});

	it('writes no cells for it, even when the document holds some', () => {
		const doc = createEmptyDoc('Projects');
		doc.fields = [{ id: 'f_back', name: 'Back', type: 'relationBack' }];
		const record = addRecord(doc);
		record.cells.f_back = ['r_one'];

		const { doc: parsed } = parseLayerDoc(serializeLayerDoc(doc));
		expect('f_back' in (parsed.records[0]?.cells ?? {})).toBe(false);
	});

	it('follows the source table when it is renamed', () => {
		const doc = createEmptyDoc('Projects');
		doc.fields = [{ ...backField, backPath: 'old/任务.layer', primary: true }];
		expect(repairRelationPaths(doc, 'old/任务.layer', 'new/任务.layer')).toBe(1);
		expect(doc.fields[0]?.backPath).toBe('new/任务.layer');
	});
});
