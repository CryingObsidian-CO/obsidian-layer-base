import { describe, expect, it } from 'vitest';
import {
	addBoardView,
	canRemoveView,
	defaultGroupField,
	removeView,
	renameView,
} from '../src/model/views';
import { createEmptyDoc } from '../src/io/schema';
import type { Field, LayerDoc } from '../src/types';

function board(fields: Field[]): LayerDoc {
	const doc = createEmptyDoc('Board');
	// Copied: the fixtures are shared, and a test that edits a column would leak into the next.
	doc.fields = fields.map((field) => ({ ...field }));
	return doc;
}

const select: Field = {
	id: 'f_status',
	name: 'Status',
	type: 'select',
	options: [{ id: 's1', name: 'To do', color: 'blue' }],
};
const text: Field = { id: 'f_text', name: 'Text', type: 'text' };
const tags: Field = { id: 'f_tags', name: 'Tags', type: 'multiSelect' };
const formula: Field = { id: 'f_calc', name: 'Calc', type: 'formula' };

describe('choosing the column a new board groups by', () => {
	it('prefers a choice, which gives the classic board', () => {
		expect(defaultGroupField([text, select])?.id).toBe(select.id);
	});

	it('uses a plain column when there is no choice', () => {
		expect(defaultGroupField([text, formula])?.id).toBe(text.id);
	});

	it('skips a multi-value column, which would put a row in several columns', () => {
		expect(defaultGroupField([tags, text])?.id).toBe(text.id);
	});

	it('falls back to a computed column rather than nothing', () => {
		expect(defaultGroupField([formula])?.id).toBe(formula.id);
	});

	it('answers nothing for a table with no columns', () => {
		expect(defaultGroupField([])).toBeUndefined();
	});
});

describe('adding a board', () => {
	it('adds one and returns it', () => {
		const doc = board([select, text]);
		const before = doc.views.length;
		const created = addBoardView(doc, 'Board');
		expect(created).not.toBeNull();
		expect(doc.views.length).toBe(before + 1);
		expect(doc.views.at(-1)?.id).toBe(created?.id);
	});

	it('groups by a suitable column without being told', () => {
		const doc = board([text, select]);
		expect(addBoardView(doc, 'Board')?.groupByFieldId).toBe(select.id);
	});

	it('starts with no card fields and no filter', () => {
		const created = addBoardView(board([select]), 'Board');
		expect(created?.cardFieldIds).toEqual([]);
		expect(created?.filter.conditions).toEqual([]);
		expect(created?.sorts).toEqual([]);
	});

	it('refuses when the table has no column to group by', () => {
		const doc = board([]);
		const before = doc.views.length;
		expect(addBoardView(doc, 'Board')).toBeNull();
		expect(doc.views.length).toBe(before);
	});

	it('names a second board so the two can be told apart', () => {
		const doc = board([select]);
		const first = addBoardView(doc, 'Board');
		const second = addBoardView(doc, 'Board');
		expect(first?.name).toBe('Board');
		expect(second?.name).toBe('Board 2');
	});

	it('leaves the rows and the columns alone', () => {
		const doc = board([select]);
		const fields = doc.fields.length;
		const records = doc.records.length;
		addBoardView(doc, 'Board');
		expect(doc.fields.length).toBe(fields);
		expect(doc.records.length).toBe(records);
	});
});

describe('removing a view', () => {
	it('removes one when another is left', () => {
		const doc = board([select]);
		addBoardView(doc, 'Board');
		const extra = doc.views.at(-1);
		expect(removeView(doc, extra?.id ?? '')).toBe(true);
		expect(doc.views.some((view) => view.id === extra?.id)).toBe(false);
	});

	it('refuses to remove the last one', () => {
		const doc = board([select]);
		expect(doc.views.length).toBe(1);
		expect(removeView(doc, doc.views[0]?.id ?? '')).toBe(false);
		expect(doc.views.length).toBe(1);
	});

	it('refuses a view that is not there', () => {
		const doc = board([select]);
		addBoardView(doc, 'Board');
		expect(removeView(doc, 'nope')).toBe(false);
	});
});

describe('renaming a view', () => {
	it('changes the name and nothing else', () => {
		const doc = board([select]);
		const boardView = addBoardView(doc, 'Board');
		const before = JSON.stringify({ ...boardView, name: '' });
		expect(renameView(doc, boardView?.id ?? '', 'Doing')).toBe(true);
		expect(boardView?.name).toBe('Doing');
		expect(JSON.stringify({ ...boardView, name: '' })).toBe(before);
	});

	it('trims what was typed', () => {
		const doc = board([select]);
		const created = addBoardView(doc, 'Board');
		renameView(doc, created?.id ?? '', '  Mine  ');
		expect(created?.name).toBe('Mine');
	});

	it('refuses a blank name rather than leaving a tab that cannot be named', () => {
		const doc = board([select]);
		const created = addBoardView(doc, 'Board');
		expect(renameView(doc, created?.id ?? '', '   ')).toBe(false);
		expect(created?.name).toBe('Board');
	});

	it('refuses a view that is not there', () => {
		const doc = board([select]);
		expect(renameView(doc, 'nope', 'X')).toBe(false);
	});

	it('allows two views to share a name', () => {
		const doc = board([select]);
		const first = addBoardView(doc, 'Board');
		const second = addBoardView(doc, 'Board');
		expect(renameView(doc, second?.id ?? '', 'Board')).toBe(true);
		expect(first?.name).toBe('Board');
		expect(second?.name).toBe('Board');
	});
});
describe('when a view may be deleted', () => {
	it('refuses only when one view is left', () => {
		const doc = board([select]);
		expect(doc.views.length).toBe(1);
		expect(removeView(doc, doc.views[0]?.id ?? '')).toBe(false);
	});

	it('refuses the table even when boards exist', () => {
		const doc = board([select]);
		const table = doc.views[0];
		addBoardView(doc, 'Board');

		expect(removeView(doc, table?.id ?? '')).toBe(false);
		expect(doc.views.some((view) => view.type === 'grid')).toBe(true);
	});

	it('removes a board while the table stays', () => {
		const doc = board([select]);
		const created = addBoardView(doc, 'Board');
		expect(removeView(doc, created?.id ?? '')).toBe(true);
		expect(doc.views.map((view) => view.type)).toEqual(['grid']);
	});

	it('says which views may be removed', () => {
		const doc = board([select]);
		const created = addBoardView(doc, 'Board');
		expect(canRemoveView(doc.views[0] as never)).toBe(false);
		expect(canRemoveView(created as never)).toBe(true);
	});
});