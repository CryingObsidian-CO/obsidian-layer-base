import { describe, expect, it } from 'vitest';
import {
	isHidden,
	setHidden,
	visibleCount,
} from '../src/model/visibility';
import { createEmptyDoc } from '../src/io/schema';
import type { Field, GridView, LayerDoc } from '../src/types';

function board(fields: Field[]): LayerDoc {
	const doc = createEmptyDoc('Board');
	doc.fields = fields.map((field) => ({ ...field }));
	return doc;
}

const a: Field = { id: 'f_a', name: 'A', type: 'text' };
const b: Field = { id: 'f_b', name: 'B', type: 'number' };
const c: Field = { id: 'f_c', name: 'C', type: 'date' };

function tableView(doc: LayerDoc): GridView {
	return doc.views.find((view) => view.type === 'grid') as GridView;
}

describe('hiding a column in a view', () => {
	it('marks it hidden and counts one fewer', () => {
		const doc = board([a, b, c]);
		const view = tableView(doc);
		expect(visibleCount(doc.fields, view)).toBe(3);

		expect(setHidden(view, b, doc.fields, true)).toBe(true);
		expect(isHidden(view, b.id)).toBe(true);
		expect(visibleCount(doc.fields, view)).toBe(2);
	});

	it('shows it again', () => {
		const doc = board([a, b]);
		const view = tableView(doc);
		setHidden(view, b, doc.fields, true);
		expect(setHidden(view, b, doc.fields, false)).toBe(true);
		expect(isHidden(view, b.id)).toBe(false);
		expect(visibleCount(doc.fields, view)).toBe(2);
	});

	it('keeps the column itself untouched', () => {
		// Hiding is a property of the view, not of the column.
		const doc = board([a, b]);
		const view = tableView(doc);
		setHidden(view, b, doc.fields, true);
		expect(doc.fields.map((field) => field.id)).toEqual([a.id, b.id]);
	});

	it('answers false when nothing changed', () => {
		const doc = board([a, b]);
		const view = tableView(doc);
		expect(setHidden(view, b, doc.fields, false)).toBe(false);
		setHidden(view, b, doc.fields, true);
		expect(setHidden(view, b, doc.fields, true)).toBe(false);
	});
});

describe('the last visible column', () => {
	it('cannot be hidden', () => {
		/*
		 * A table with no columns left has nothing to draw and no way back to a visible
		 * column, so the last one stays.
		 */
		const doc = board([a, b]);
		const view = tableView(doc);
		setHidden(view, a, doc.fields, true);
		expect(setHidden(view, b, doc.fields, true)).toBe(false);
		expect(visibleCount(doc.fields, view)).toBe(1);
	});

	it('can be shown once another is visible again', () => {
		const doc = board([a, b]);
		const view = tableView(doc);
		setHidden(view, a, doc.fields, true);
		expect(setHidden(view, b, doc.fields, true)).toBe(false);

		setHidden(view, a, doc.fields, false);
		expect(setHidden(view, b, doc.fields, true)).toBe(true);
	});
});

describe('views of the same table', () => {
	it('hide columns independently', () => {
		// A view is a way of looking at the rows, so one view's hidden columns do not
		// reach another's.
		const doc = board([a, b, c]);
		const first = tableView(doc);
		const second = { ...first, id: 'v_second', hiddenFieldIds: [] };
		setHidden(first, b, doc.fields, true);

		expect(isHidden(first, b.id)).toBe(true);
		expect(isHidden(second, b.id)).toBe(false);
	});
});
