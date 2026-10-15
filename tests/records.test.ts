import { describe, expect, it } from 'vitest';
import {
	addRecord,
	clearRecord,
	duplicateField,
	duplicateRecord,
	duplicateRecords,
	findRecord,
	insertRecordAfter,
	insertRecordsAfter,
	moveFieldBefore,
	removeRecord,
	removeRecords,
	setCellFromText,
	setCellValue,
} from '../src/model/records';
import { createEmptyDoc, parseLayerDoc, serializeLayerDoc } from '../src/io/schema';
import type { Field, GridView, LayerDoc } from '../src/types';

const TITLE: Field = { id: 'f_title', name: 'Title', type: 'text', primary: true };
const STATUS: Field = {
	id: 'f_status',
	name: 'Status',
	type: 'select',
	options: [
		{ id: 'o_1', name: 'To do', color: 'default' },
		{ id: 'o_2', name: 'Done', color: 'green' },
	],
};

const GRID: GridView = {
	id: 'v_table',
	name: 'Table',
	type: 'grid',
	filter: { conjunction: 'and', conditions: [] },
	sorts: [],
	hiddenFieldIds: [],
	columnWidths: {},
	rowHeights: {},
};

function newDoc(): LayerDoc {
	const doc = createEmptyDoc('Board');
	doc.fields = [{ ...TITLE }, { ...STATUS, options: STATUS.options?.map((o) => ({ ...o })) }];
	doc.views = [GRID];
	return doc;
}

function docWithRecord(): { doc: LayerDoc; recordId: string } {
	const doc = newDoc();
	const record = addRecord(doc);
	return { doc, recordId: record.id };
}

describe('setCellValue', () => {
	it('stores a value', () => {
		const { doc, recordId } = docWithRecord();
		expect(setCellValue(doc, recordId, TITLE, 'Hello')).toBe(true);
		expect(findRecord(doc, recordId)?.cells.f_title).toBe('Hello');
	});

	it('removes the key when the value is cleared', () => {
		const { doc, recordId } = docWithRecord();
		setCellValue(doc, recordId, TITLE, 'Hello');
		setCellValue(doc, recordId, TITLE, '');

		expect('f_title' in (findRecord(doc, recordId)?.cells ?? {})).toBe(false);
	});

	it('reports failure for a record that no longer exists', () => {
		const { doc, recordId } = docWithRecord();
		removeRecord(doc, recordId);

		expect(setCellValue(doc, recordId, TITLE, 'x')).toBe(false);
	});
});

describe('setCellFromText', () => {
	it('applies text to a text column', () => {
		const { doc, recordId } = docWithRecord();

		expect(setCellFromText(doc, recordId, TITLE, 'Pasted')).toBe(true);
		expect(findRecord(doc, recordId)?.cells.f_title).toBe('Pasted');
	});

	it('resolves an option name for a select column', () => {
		const { doc, recordId } = docWithRecord();

		expect(setCellFromText(doc, recordId, STATUS, 'Done')).toBe(true);
		expect(findRecord(doc, recordId)?.cells.f_status).toBe('o_2');
	});

	it('leaves the cell alone and reports failure for unknown text', () => {
		const { doc, recordId } = docWithRecord();
		setCellValue(doc, recordId, STATUS, 'o_1');

		expect(setCellFromText(doc, recordId, STATUS, 'Archived')).toBe(false);
		expect(findRecord(doc, recordId)?.cells.f_status).toBe('o_1');
	});
});

describe('addRecord', () => {
	it('appends a record with an ISO timestamp and no cells', () => {
		const doc = newDoc();
		const record = addRecord(doc);

		expect(doc.records).toHaveLength(1);
		expect(record.cells).toEqual({});
		expect(record.created).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(new Date(record.created).toString()).not.toBe('Invalid Date');
	});

	it('gives each record a distinct id', () => {
		const doc = newDoc();
		const ids = [addRecord(doc).id, addRecord(doc).id, addRecord(doc).id];

		expect(new Set(ids).size).toBe(3);
	});
});

describe('insertRecordAfter', () => {
	it('places the new row directly below its anchor', () => {
		const doc = newDoc();
		const first = addRecord(doc);
		const last = addRecord(doc);

		const inserted = insertRecordAfter(doc, first.id);

		expect(doc.records.map((r) => r.id)).toEqual([
			first.id,
			inserted.id,
			last.id,
		]);
	});

	it('appends when the anchor is gone', () => {
		const doc = newDoc();
		const existing = addRecord(doc);

		const inserted = insertRecordAfter(doc, 'r_missing');

		expect(doc.records.map((r) => r.id)).toEqual([existing.id, inserted.id]);
	});
});

describe('removeRecord', () => {
	it('removes one record and reports success', () => {
		const doc = newDoc();
		const a = addRecord(doc);
		addRecord(doc);

		expect(removeRecord(doc, a.id)).toBe(true);
		expect(doc.records.map((r) => r.id)).not.toContain(a.id);
		expect(doc.records).toHaveLength(1);
	});

	it('reports failure for an unknown record', () => {
		const doc = newDoc();
		expect(removeRecord(doc, 'r_missing')).toBe(false);
	});
});

describe('duplicateRecord', () => {
	it('copies the values into a new row after the original', () => {
		const { doc, recordId } = docWithRecord();
		setCellValue(doc, recordId, TITLE, 'Original');
		const second = addRecord(doc);

		const copy = duplicateRecord(doc, recordId);

		expect(copy?.cells).toEqual({ f_title: 'Original' });
		expect(copy?.id).not.toBe(recordId);
		expect(doc.records.map((r) => r.id)).toEqual([
			recordId,
			copy?.id,
			second.id,
		]);
	});

	it('gives the copy its own timestamp', () => {
		const { doc, recordId } = docWithRecord();
		const source = findRecord(doc, recordId);
		if (source) {
			source.created = '2020-01-01T00:00:00.000Z';
		}

		const copy = duplicateRecord(doc, recordId);

		expect(copy?.created).not.toBe('2020-01-01T00:00:00.000Z');
		expect(copy?.created).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});

	it('editing the copy leaves the source untouched', () => {
		const { doc, recordId } = docWithRecord();
		setCellValue(doc, recordId, TITLE, 'Original');
		const copy = duplicateRecord(doc, recordId);

		if (copy) {
			setCellValue(doc, copy.id, TITLE, 'Changed');
		}

		expect(findRecord(doc, recordId)?.cells.f_title).toBe('Original');
	});

	it('returns null for a record that is gone', () => {
		const { doc, recordId } = docWithRecord();
		removeRecord(doc, recordId);

		expect(duplicateRecord(doc, recordId)).toBeNull();
	});
});

describe('clearRecord', () => {
	it('empties the cells but keeps the row', () => {
		const { doc, recordId } = docWithRecord();
		setCellValue(doc, recordId, TITLE, 'Something');

		expect(clearRecord(doc, recordId)).toBe(true);
		expect(doc.records).toHaveLength(1);
		expect(findRecord(doc, recordId)?.cells).toEqual({});
	});

	it('reports failure for a record that is gone', () => {
		const { doc, recordId } = docWithRecord();
		removeRecord(doc, recordId);

		expect(clearRecord(doc, recordId)).toBe(false);
	});
});

describe('duplicateField', () => {
	it('copies the definition and inserts it after the source', () => {
		const doc = newDoc();
		const source = doc.fields[0]!;

		const copy = duplicateField(doc, source.id);

		expect(copy?.type).toBe(source.type);
		expect(copy?.name).toContain(source.name);
		expect(doc.fields[1]?.id).toBe(copy?.id);
	});

	it('does not copy cell values', () => {
		const { doc, recordId } = docWithRecord();
		setCellValue(doc, recordId, TITLE, 'Value');

		const copy = duplicateField(doc, TITLE.id);

		expect(copy).not.toBeNull();
		expect(findRecord(doc, recordId)?.cells[TITLE.id]).toBe('Value');
		expect(findRecord(doc, recordId)?.cells[copy?.id ?? '']).toBeUndefined();
	});

	it('regenerates option ids so the copy cannot collide', () => {
		const doc = newDoc();
		const source = doc.fields[1]!;

		const copy = duplicateField(doc, source.id);
		const sourceIds = source.options?.map((o) => o.id) ?? [];
		const copyIds = copy?.options?.map((o) => o.id) ?? [];

		expect(copyIds).toHaveLength(sourceIds.length);
		for (const id of copyIds) {
			expect(sourceIds).not.toContain(id);
		}
	});

	it('leaves the copy non-primary even when the source is primary', () => {
		const doc = newDoc();
		const primary = doc.fields.find((f) => f.primary);

		const copy = duplicateField(doc, primary?.id ?? '');

		expect(copy?.primary).toBeUndefined();
		expect(doc.fields.filter((f) => f.primary)).toHaveLength(1);
	});

	it('returns null for a field that is gone', () => {
		const doc = newDoc();
		expect(duplicateField(doc, 'f_missing')).toBeNull();
	});
});

describe('moveFieldBefore', () => {
	it('moves a column to sit before another', () => {
		const doc = newDoc();
		// fields are [TITLE, STATUS]; move STATUS to the front.
		expect(moveFieldBefore(doc, STATUS.id, TITLE.id)).toBe(true);

		expect(doc.fields.map((f) => f.id)).toEqual([STATUS.id, TITLE.id]);
	});

	it('appends when the anchor is null', () => {
		const doc = newDoc();
		expect(moveFieldBefore(doc, TITLE.id, null)).toBe(true);

		expect(doc.fields.map((f) => f.id)).toEqual([STATUS.id, TITLE.id]);
	});

	it('leaves the hidden columns in place', () => {
		const doc = newDoc();
		const hidden: Field = { id: 'f_hidden', name: 'Hidden', type: 'text' };
		doc.fields.splice(1, 0, hidden);

		// Visible order is [TITLE, STATUS, hidden]; drag STATUS before TITLE.
		expect(moveFieldBefore(doc, STATUS.id, TITLE.id)).toBe(true);

		expect(doc.fields.map((f) => f.id)).toEqual([
			STATUS.id,
			TITLE.id,
			hidden.id,
		]);
	});

	it('changes nothing when either id is unknown', () => {
		const doc = newDoc();
		const before = doc.fields.map((f) => f.id);

		expect(moveFieldBefore(doc, 'f_missing', TITLE.id)).toBe(false);
		expect(moveFieldBefore(doc, TITLE.id, 'f_missing')).toBe(false);

		expect(doc.fields.map((f) => f.id)).toEqual(before);
	});

	it('does nothing when a column is dropped on itself', () => {
		const doc = newDoc();
		const before = doc.fields.map((f) => f.id);

		expect(moveFieldBefore(doc, TITLE.id, TITLE.id)).toBe(false);
		expect(doc.fields.map((f) => f.id)).toEqual(before);
	});

	it('does not disturb values or the primary flag', () => {
		const { doc, recordId } = docWithRecord();
		setCellValue(doc, recordId, TITLE, 'Kept');
		setCellValue(doc, recordId, STATUS, 'o_2');

		moveFieldBefore(doc, STATUS.id, TITLE.id);

		expect(findRecord(doc, recordId)?.cells).toEqual({
			f_title: 'Kept',
			f_status: 'o_2',
		});
		expect(doc.fields.filter((f) => f.primary).map((f) => f.id)).toEqual([
			TITLE.id,
		]);
	});

	it('produces a document that still parses cleanly', () => {
		const doc = newDoc();
		moveFieldBefore(doc, STATUS.id, TITLE.id);

		const { warnings } = parseLayerDoc(serializeLayerDoc(doc));

		expect(warnings).toEqual([]);
	});
});

describe('batch row operations', () => {
	it('inserts as many blank rows as were asked for', () => {
		const { doc, recordId } = docWithRecord();

		const inserted = insertRecordsAfter(doc, recordId, 3);

		expect(inserted).toHaveLength(3);
		expect(doc.records).toHaveLength(4);
		expect(doc.records[0]?.id).toBe(recordId);
		expect(doc.records.slice(1).map((r) => r.id)).toEqual(
			inserted.map((r) => r.id),
		);
	});

	it('deletes every row it is given', () => {
		const { doc, recordId } = docWithRecord();
		const doomed = [addRecord(doc).id, addRecord(doc).id, addRecord(doc).id];
		const keep = addRecord(doc).id;

		expect(removeRecords(doc, doomed)).toBe(3);

		expect(doc.records.map((r) => r.id)).toEqual([recordId, keep]);
	});

	it('counts only the rows that were actually there', () => {
		const { doc, recordId } = docWithRecord();

		expect(removeRecords(doc, [recordId, 'r_gone'])).toBe(1);
	});

	it('duplicates every row, each copy below its source', () => {
		const { doc } = docWithRecord();
		const a = addRecord(doc);
		const b = addRecord(doc);
		setCellValue(doc, a.id, TITLE, 'first');
		setCellValue(doc, b.id, TITLE, 'second');

		expect(duplicateRecords(doc, [a.id, b.id])).toBe(2);

		expect(doc.records).toHaveLength(5);
		expect(doc.records[1]?.id).toBe(a.id);
		expect(doc.records[2]?.cells.f_title).toBe('first');
		expect(doc.records[3]?.id).toBe(b.id);
		expect(doc.records[4]?.cells.f_title).toBe('second');
	});

	it('survives a save and reload', () => {
		const { doc, recordId } = docWithRecord();
		setCellValue(doc, recordId, TITLE, 'kept');

		duplicateRecords(doc, [recordId]);
		insertRecordsAfter(doc, recordId, 1);

		const { warnings } = parseLayerDoc(serializeLayerDoc(doc));

		expect(warnings).toEqual([]);
		expect(doc.records).toHaveLength(3);
	});
});

describe('edits survive a save and reload', () => {
	it('round-trips an edited board without warnings', () => {
		const { doc, recordId } = docWithRecord();
		setCellValue(doc, recordId, TITLE, 'Write the plan');
		setCellValue(doc, recordId, STATUS, 'o_2');

		const { doc: reloaded, warnings } = parseLayerDoc(serializeLayerDoc(doc));

		expect(warnings).toEqual([]);
		const record = reloaded.records[0];
		expect(record?.cells.f_title).toBe('Write the plan');
		expect(record?.cells.f_status).toBe('o_2');
	});

	it('a cleared cell stays cleared after reload', () => {
		const { doc, recordId } = docWithRecord();
		setCellValue(doc, recordId, TITLE, 'temporary');
		setCellValue(doc, recordId, TITLE, '');

		const { doc: reloaded } = parseLayerDoc(serializeLayerDoc(doc));

		expect(reloaded.records[0]?.cells).toEqual({});
	});

	it('drops a cell whose field id is not in the document', () => {
		const { doc, recordId } = docWithRecord();
		setCellValue(doc, recordId, { id: 'f_ghost', name: 'Ghost', type: 'text' }, 'boo');

		const { doc: reloaded } = parseLayerDoc(serializeLayerDoc(doc));

		expect(reloaded.records[0]?.cells).toEqual({});
	});
});
