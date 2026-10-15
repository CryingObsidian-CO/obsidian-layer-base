import { describe, expect, it } from 'vitest';
import {
	addField,
	addRecord,
	changeFieldType,
	insertFieldAfter,
	removeField,
	setCellValue,
} from '../src/model/records';
import { createEmptyDoc, parseLayerDoc, serializeLayerDoc } from '../src/io/schema';
import type { Field, LayerDoc, SelectOption } from '../src/types';

const OPTIONS: SelectOption[] = [
	{ id: 'o_1', name: 'To do', color: 'default' },
	{ id: 'o_2', name: 'Done', color: 'green' },
];

function newDoc(): LayerDoc {
	const doc = createEmptyDoc('Board');
	doc.fields = [
		{ id: 'f_title', name: 'Title', type: 'text', primary: true },
		{
			id: 'f_status',
			name: 'Status',
			type: 'select',
			options: OPTIONS.map((o) => ({ ...o })),
		},
	];
	return doc;
}

describe('removeField', () => {
	it('drops the field and every cell holding it', () => {
		const doc = newDoc();
		const record = addRecord(doc);
		setCellValue(doc, record.id, doc.fields[1]!, 'o_1');

		expect(removeField(doc, 'f_status')).toBe(true);
		expect(doc.fields.map((f) => f.id)).not.toContain('f_status');
		expect('f_status' in (doc.records[0]?.cells ?? {})).toBe(false);
	});

	it('clears references held by views', () => {
		const doc = newDoc();
		const view = doc.views[0]!;
		view.hiddenFieldIds = ['f_status'];
		view.sorts = [{ fieldId: 'f_status', order: 'asc' }];
		view.filter.conditions = [
			{ fieldId: 'f_status', operator: 'is', value: 'o_1' },
			{ fieldId: 'f_title', operator: 'is', value: 'x' },
		];

		removeField(doc, 'f_status');

		expect(view.hiddenFieldIds).toEqual([]);
		expect(view.sorts).toEqual([]);
		// Unrelated conditions must survive the cleanup.
		expect(view.filter.conditions).toEqual([
			{ fieldId: 'f_title', operator: 'is', value: 'x' },
		]);
	});

	it('repoints a board whose grouping field was deleted', () => {
		const doc = newDoc();
		doc.fields.push({
			id: 'f_other',
			name: 'Other',
			type: 'select',
			options: [],
		});
		const board = doc.views.find((v) => v.type === 'kanban');
		if (board?.type === 'kanban') {
			board.groupByFieldId = 'f_other';
		}

		removeField(doc, 'f_other');

		const after = doc.views.find((v) => v.type === 'kanban');
		expect(after?.type).toBe('kanban');
		if (after?.type === 'kanban') {
			// The seed board groups by f_status, which still exists.
			expect(after.groupByFieldId).toBe('f_status');
		}
	});

	it('demotes a board to a table when no option field is left', () => {
		const doc = newDoc();
		doc.fields = doc.fields.filter((f) => f.type === 'text');
		doc.fields.push({ id: 'f_only', name: 'Only', type: 'select', options: [] });
		const board = doc.views.find((v) => v.type === 'kanban');
		if (board?.type === 'kanban') {
			board.groupByFieldId = 'f_only';
		}

		removeField(doc, 'f_only');

		const after = doc.views.find((v) => v.id === board?.id);
		expect(after?.type).toBe('grid');
		expect(after === undefined ? true : !('groupByFieldId' in after)).toBe(true);
	});

	it('keeps a primary field so records still have a title', () => {
		const doc = newDoc();
		expect(removeField(doc, 'f_title')).toBe(true);

		expect(doc.fields.filter((f) => f.primary)).toHaveLength(1);
	});

	it('reports failure for an unknown field', () => {
		const doc = newDoc();
		expect(removeField(doc, 'f_missing')).toBe(false);
	});

	it('produces a document that still parses cleanly', () => {
		const doc = newDoc();
		const record = addRecord(doc);
		setCellValue(doc, record.id, doc.fields[1]!, 'o_1');
		removeField(doc, 'f_status');

		const { warnings } = parseLayerDoc(serializeLayerDoc(doc));

		expect(warnings).toEqual([]);
	});
});

describe('addField', () => {
	it('makes the first field of an empty board primary', () => {
		const doc = createEmptyDoc('Board');
		doc.fields = [];
		const field: Field = { id: 'f_new', name: 'First', type: 'text' };

		addField(doc, field);

		expect(field.primary).toBe(true);
	});

	it('does not touch the primary flag once a board has fields', () => {
		const doc = newDoc();
		const field: Field = { id: 'f_new', name: 'Extra', type: 'text' };

		addField(doc, field);

		expect(field.primary).toBeUndefined();
		expect(doc.fields.filter((f) => f.primary)).toHaveLength(1);
	});
});

describe('insertFieldAfter', () => {
	it('places the new column directly after its anchor', () => {
		const doc = newDoc();
		const anchor = doc.fields[0]!;

		insertFieldAfter(doc, anchor.id, {
			id: 'f_new',
			name: 'New',
			type: 'text',
		});

		expect(doc.fields.map((f) => f.id)).toEqual([
			anchor.id,
			'f_new',
			'f_status',
		]);
	});

	it('appends when the anchor is gone', () => {
		const doc = newDoc();

		insertFieldAfter(doc, 'f_missing', {
			id: 'f_new',
			name: 'New',
			type: 'text',
		});

		expect(doc.fields.map((f) => f.id)).toEqual([
			'f_title',
			'f_status',
			'f_new',
		]);
	});
});

describe('changeFieldType', () => {
	it('clears the values the new type cannot hold and counts them', () => {
		const doc = newDoc();
		const record = addRecord(doc);
		setCellValue(doc, record.id, doc.fields[0]!, '42');
		setCellValue(doc, record.id, doc.fields[1]!, 'o_1');

		const dropped = changeFieldType(doc, 'f_title', 'select');

		expect(dropped).toBe(1);
		expect('f_title' in (doc.records[0]?.cells ?? {})).toBe(false);
		expect(doc.records[0]?.cells.f_status).toBe('o_1');
	});

	it('gives a select column an empty option list', () => {
		const doc = newDoc();
		changeFieldType(doc, 'f_title', 'select');

		expect(doc.fields[0]?.options).toEqual([]);
	});

	it('drops options when leaving select', () => {
		const doc = newDoc();
		changeFieldType(doc, 'f_status', 'text');

		expect(doc.fields[1]?.options).toBeUndefined();
	});

	it('does nothing when the type is unchanged', () => {
		const doc = newDoc();
		expect(changeFieldType(doc, 'f_title', 'text')).toBe(0);
	});

	it('keeps the document parseable after a change', () => {
		const doc = newDoc();
		addRecord(doc);
		changeFieldType(doc, 'f_title', 'select');

		const { warnings } = parseLayerDoc(serializeLayerDoc(doc));

		expect(warnings).toEqual([]);
	});
});
