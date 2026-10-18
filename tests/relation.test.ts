import { describe, expect, it } from 'vitest';
import {
	createEmptyDoc,
	parseLayerDoc,
	serializeLayerDoc,
} from '../src/io/schema';
import {
	deserializeCellValue,
	emptyValueFor,
	relationIds,
	serializeCellValue,
} from '../src/model/fields';
import {
	relationCandidates,
	relationText,
	repairRelationPaths,
} from '../src/model/relation';
import {
	addRecord,
	changeFieldType,
	clearCells,
	clearFieldCells,
	setCellValue,
} from '../src/model/records';
import type { Field, LayerDoc } from '../src/types';

/** The table a relation reads: two rows with a value, one without. */
function sourceTable(): LayerDoc {
	const doc = createEmptyDoc('Projects');
	doc.fields = [
		{ id: 'f_title', name: 'Name', type: 'text', primary: true },
		{ id: 'f_owner', name: 'Owner', type: 'text' },
	];
	doc.records = [
		{ id: 'r_a', created: '2026-01-01T00:00:00.000Z', cells: { f_title: 'Alpha' } },
		{ id: 'r_b', created: '2026-01-01T00:00:00.000Z', cells: { f_title: 'Beta' } },
		{ id: 'r_c', created: '2026-01-01T00:00:00.000Z', cells: {} },
	];
	return doc;
}

const relationField: Field = {
	id: 'f_link',
	name: 'Projects',
	type: 'relation',
	linkFieldId: 'f_title',
};

describe('relationIds', () => {
	it('reads the ids a cell holds', () => {
		expect(relationIds(['r_a', 'r_b'])).toEqual(['r_a', 'r_b']);
	});

	it('treats a non-array as nothing', () => {
		expect(relationIds('r_a')).toEqual([]);
		expect(relationIds('')).toEqual([]);
		expect(relationIds(false)).toEqual([]);
	});

	it('drops anything that is not a string id', () => {
		expect(relationIds(['r_a', 7, null] as never)).toEqual(['r_a']);
	});
});

describe('relationCandidates', () => {
	it('offers the values of the linked column', () => {
		expect(relationCandidates(sourceTable(), 'f_title')).toEqual([
			{ recordId: 'r_a', text: 'Alpha' },
			{ recordId: 'r_b', text: 'Beta' },
		]);
	});

	it('leaves out a row with nothing in that column', () => {
		// r_c has no value, so it has nothing to contribute.
		const texts = relationCandidates(sourceTable(), 'f_title').map((c) => c.text);
		expect(texts).not.toContain('');
	});

	it('offers nothing when the column is gone', () => {
		expect(relationCandidates(sourceTable(), 'f_missing')).toEqual([]);
	});

	it('reads the column through its own type, not as raw storage', () => {
		const doc = sourceTable();
		doc.fields.push({ id: 'f_done', name: 'Done', type: 'checkbox' });
		doc.records[0]!.cells.f_done = true;
		expect(relationCandidates(doc, 'f_done')).toEqual([
			{ recordId: 'r_a', text: 'true' },
		]);
	});
});

describe('relationText', () => {
	it('gives the values one by one, so a cell can chip them', () => {
		expect(relationText(sourceTable(), 'f_title', ['r_b', 'r_a'])).toEqual({
			// Stored order, not the table's: the cell says what it says.
			texts: ['Beta', 'Alpha'],
			broken: 0,
		});
	});

	it('falls back to the target row numbers when no column is chosen', () => {
		// An unconfigured relation still says which rows it points at.
		expect(relationText(sourceTable(), '', ['r_b', 'r_a'])).toEqual({
			texts: ['2', '1'],
			broken: 0,
		});
	});

	it('counts a missing row even with no column chosen', () => {
		expect(relationText(sourceTable(), '', ['r_a', 'r_gone'])).toEqual({
			texts: ['1'],
			broken: 1,
		});
	});

	it('counts the rows that are gone instead of hiding them', () => {
		expect(relationText(sourceTable(), 'f_title', ['r_a', 'r_gone'])).toEqual({
			texts: ['Alpha'],
			broken: 1,
		});
	});

	it('reports every id as broken when the column is gone', () => {
		expect(relationText(sourceTable(), 'f_missing', ['r_a', 'r_b'])).toEqual({
			texts: [],
			broken: 2,
		});
	});

	it('reads an empty cell as nothing at all', () => {
		expect(relationText(sourceTable(), 'f_title', [])).toEqual({
			texts: [],
			broken: 0,
		});
	});
});

describe('through the file', () => {
	function relationDoc(): LayerDoc {
		const doc = createEmptyDoc('Tasks');
		doc.fields = [{ ...relationField, primary: true }];
		return doc;
	}

	it('keeps the target table and column', () => {
		const doc = relationDoc();
		doc.fields[0]!.linkPath = '项目/项目表.layer';
		const { doc: parsed } = parseLayerDoc(serializeLayerDoc(doc));
		const field = parsed.fields[0];
		expect(field?.type).toBe('relation');
		expect(field?.linkPath).toBe('项目/项目表.layer');
		expect(field?.linkFieldId).toBe('f_title');
	});

	it('keeps a self-reference out of the file, since no path is needed', () => {
		const doc = relationDoc();
		const raw = JSON.parse(serializeLayerDoc(doc)) as {
			fields: Record<string, unknown>[];
		};
		expect('linkPath' in (raw.fields[0] ?? {})).toBe(false);
	});

	it('keeps the cell ids as an array of strings', () => {
		const doc = relationDoc();
		const record = addRecord(doc);
		record.cells.f_link = ['r_a', 'r_b'];

		const { doc: parsed } = parseLayerDoc(serializeLayerDoc(doc));
		expect(parsed.records[0]?.cells.f_link).toEqual(['r_a', 'r_b']);
	});

	it('takes an array and refuses anything else', () => {
		const doc = relationDoc();
		const record = addRecord(doc);
		const field = doc.fields[0]!;
		expect(setCellValue(doc, record.id, field, 'r_a')).toBe(false);
		expect(setCellValue(doc, record.id, field, ['r_a'])).toBe(true);
		expect(record.cells.f_link).toEqual(['r_a']);
	});

	it('drops the target when the field stops being a relation', () => {
		const doc = relationDoc();
		doc.fields[0]!.linkPath = 'a.layer';
		changeFieldType(doc, 'f_link', 'text');
		expect(doc.fields[0]?.linkPath).toBeUndefined();
		expect(doc.fields[0]?.linkFieldId).toBeUndefined();
	});
});

describe('the shapes the grid passes a relation value through', () => {
	it('clears with the empty value of its own shape', () => {
		// `''` is not a relation value, so clearing has to hand it an empty array.
		expect(emptyValueFor(relationField)).toEqual([]);
		const doc = createEmptyDoc('Tasks');
		doc.fields = [{ ...relationField }];
		const record = addRecord(doc);
		record.cells.f_link = ['r_a'];
		expect(clearCells(doc, [record.id], doc.fields)).toBe(1);
		expect('f_link' in record.cells).toBe(false);
	});

	it('reads back from a cell dataset as an array, not as its JSON text', () => {
		// Filling a range round-trips the value through `dataset`, which is text.
		const raw = serializeCellValue(['r_a', 'r_b']);
		expect(deserializeCellValue(raw, relationField)).toEqual(['r_a', 'r_b']);
		expect(deserializeCellValue('', relationField)).toEqual([]);
	});
});

describe('repairRelationPaths', () => {
	function docLinkingTo(path: string): LayerDoc {
		const doc = createEmptyDoc('Tasks');
		doc.fields = [
			{ ...relationField, linkPath: path },
			{ id: 'f_text', name: 'Note', type: 'text' },
		];
		return doc;
	}

	it('follows a renamed table', () => {
		const doc = docLinkingTo('项目/旧名.layer');
		expect(repairRelationPaths(doc, '项目/旧名.layer', '归档/新名.layer')).toBe(1);
		expect(doc.fields[0]?.linkPath).toBe('归档/新名.layer');
	});

	it('leaves links that point elsewhere alone', () => {
		const doc = docLinkingTo('a/other.layer');
		expect(repairRelationPaths(doc, '项目/旧名.layer', '归档/新名.layer')).toBe(0);
		expect(doc.fields[0]?.linkPath).toBe('a/other.layer');
	});

	it('never touches a field of another type', () => {
		const doc = createEmptyDoc('Tasks');
		doc.fields = [{ id: 'f_t', name: 'Text', type: 'text', linkPath: 'x.layer' }];
		expect(repairRelationPaths(doc, 'x.layer', 'y.layer')).toBe(0);
	});
});

describe('clearFieldCells', () => {
	it('removes one column and leaves the others', () => {
		const doc = createEmptyDoc('Tasks');
		doc.fields = [
			{ ...relationField, primary: true },
			{ id: 'f_note', name: 'Note', type: 'text' },
		];
		const record = addRecord(doc);
		record.cells.f_link = ['r_a'];
		record.cells.f_note = 'keep me';

		expect(clearFieldCells(doc, 'f_link')).toBe(1);
		expect('f_link' in record.cells).toBe(false);
		expect(record.cells.f_note).toBe('keep me');
	});

	it('reports nothing when the column was already empty', () => {
		const doc = createEmptyDoc('Tasks');
		doc.fields = [{ ...relationField }];
		addRecord(doc);
		expect(clearFieldCells(doc, 'f_link')).toBe(0);
	});
});
