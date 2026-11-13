import { describe, expect, it } from 'vitest';
import { sameDocument } from '../src/io/same-document';
import {
	createEmptyDoc,
	parseLayerDoc,
	serializeLayerDoc,
} from '../src/io/schema';
import { addRecord, setCellValue } from '../src/model/records';
import { addBoardView, renameView } from '../src/model/views';
import { setColumnWidth } from '../src/model/layout';
import type { LayerDoc } from '../src/types';

function board(): LayerDoc {
	const doc = createEmptyDoc('Board');
	const record = addRecord(doc);
	const [title, status] = doc.fields;
	if (title) {
		setCellValue(doc, record.id, title, 'Task');
	}
	if (status) {
		setCellValue(doc, record.id, status, status.options?.[0]?.id ?? '');
	}
	addBoardView(doc, 'Board');
	const grid = doc.views[0];
	if (grid && grid.type === 'grid' && title) {
		setColumnWidth(grid, title.id, 220);
	}
	return doc;
}

function readBack(doc: LayerDoc): LayerDoc {
	return parseLayerDoc(serializeLayerDoc(doc)).doc;
}

function firstView(doc: LayerDoc) {
	const view = doc.views[0];
	if (!view) {
		throw new Error('the board has no view');
	}
	return view;
}

describe('sameDocument', () => {
	it('counts a document read back from its own write as the same', () => {
		const doc = board();
		expect(sameDocument(readBack(doc), doc)).toBe(true);
	});

	it('ignores the order the members happen to be written in', () => {
		const doc = board();
		const record = doc.records[0];
		if (!record) {
			throw new Error('the board has no record');
		}
		const reversedCells = Object.fromEntries(
			Object.entries(record.cells).reverse(),
		);
		const same: LayerDoc = {
			views: doc.views,
			records: [{ cells: reversedCells, created: record.created, id: record.id }],
			fields: doc.fields,
			name: doc.name,
			version: doc.version,
		};
		expect(sameDocument(same, doc)).toBe(true);
	});

	it('counts an outside rename of the document as a change', () => {
		const doc = board();
		expect(sameDocument({ ...doc, name: 'Renamed board' }, doc)).toBe(false);
	});

	it('counts an outside rename of a view as a change', () => {
		const doc = board();
		const changed = structuredClone(doc);
		const ok = renameView(changed, firstView(changed).id, 'Renamed view');
		expect(ok).toBe(true);
		expect(sameDocument(changed, doc)).toBe(false);
	});

	it('counts a changed filter as a change', () => {
		const doc = board();
		const changed = structuredClone(doc);
		const view = firstView(changed);
		view.filter.conditions.push({ fieldId: 'f_x', operator: 'is', value: 'x' });
		expect(sameDocument(changed, doc)).toBe(false);
	});

	it('counts a changed board setting as a change', () => {
		const doc = board();
		const changed = structuredClone(doc);
		const kanban = changed.views.find((view) => view.type === 'kanban');
		if (!kanban) {
			throw new Error('the board has no kanban view');
		}
		kanban.columnLimit = 5;
		expect(sameDocument(changed, doc)).toBe(false);
	});

	it('still counts a changed value as a change', () => {
		const doc = board();
		const changed = structuredClone(doc);
		const record = changed.records[0];
		const title = changed.fields[0];
		if (!record || !title) {
			throw new Error('the board is not built');
		}
		setCellValue(changed, record.id, title, 'Edited');
		expect(sameDocument(changed, doc)).toBe(false);
	});

	it('counts a reordered column as a change', () => {
		const doc = board();
		const changed = structuredClone(doc);
		changed.fields.reverse();
		expect(sameDocument(changed, doc)).toBe(false);
	});
});
