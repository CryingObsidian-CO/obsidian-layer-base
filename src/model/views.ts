import type { Field, KanbanView, LayerDoc, View } from '../types';
import { isDerived } from './fields';

/**
 * Adding and removing the views of a table.
 *
 * A view is a way of looking at the same rows, so these functions only ever touch
 * `doc.views`: the records and the columns are untouched.
 */

/** Names a new board so it does not repeat one already taken. */
function uniqueName(views: readonly View[], base: string): string {
	const taken = new Set(views.map((view) => view.name));
	if (!taken.has(base)) {
		return base;
	}
	for (let attempt = 2; attempt < 1000; attempt += 1) {
		const candidate = `${base} ${attempt}`;
		if (!taken.has(candidate)) {
			return candidate;
		}
	}
	return base;
}

/**
 * The column a new board should group by.
 *
 * A choice gives the classic board, so one is preferred. Failing that, any column
 * whose cells hold a single value will do — a board of dates or numbers is one
 * column per value, which is a real way to look at a table. A computed column is
 * the last resort: it can be grouped by, but its cards cannot be dragged.
 */
export function defaultGroupField(fields: readonly Field[]): Field | undefined {
	const select = fields.find((field) => field.type === 'select');
	if (select) {
		return select;
	}
	const plain = fields.find(
		(field) => !isDerived(field.type) && field.type !== 'multiSelect',
	);
	return plain ?? fields[0];
}

/**
 * Adds a board view and returns it, or null when the table has no column to group
 * by — a board without one has nothing to draw.
 */
export function addBoardView(
	doc: LayerDoc,
	baseName: string,
): KanbanView | null {
	const group = defaultGroupField(doc.fields);
	if (!group) {
		return null;
	}
	const view: KanbanView = {
		id: `v_${Math.random().toString(36).slice(2, 10)}`,
		name: uniqueName(doc.views, baseName),
		type: 'kanban',
		groupByFieldId: group.id,
		cardFieldIds: [],
		filter: { conjunction: 'and', conditions: [] },
		sorts: [],
		hiddenFieldIds: [],
	};
	doc.views.push(view);
	return view;
}

/**
 * Removes a view, answering whether one was removed.
 *
 * The table cannot go: it is the data's own view, and every other view looks at the
 * rows through it. A board may come and go freely.
 */
export function removeView(doc: LayerDoc, viewId: string): boolean {
	const index = doc.views.findIndex((view) => view.id === viewId);
	if (index === -1) {
		return false;
	}
	const view = doc.views[index];
	if (view === undefined || !canRemoveView(view)) {
		return false;
	}
	// A table is always present, so this guards a hand-edited file rather than a
	// state the reader can reach.
	if (doc.views.length <= 1) {
		return false;
	}
	doc.views.splice(index, 1);
	return true;
}

/** Whether this view may be removed. */
export function canRemoveView(view: View): boolean {
	return view.type !== 'grid';
}

/**
 * Renames a view.
 *
 * A blank name is refused rather than written: an unnamed tab cannot be clicked
 * back to by name. The name need not be unique — two boards may be called the
 * same — because each tab is its own and the icon tells them apart.
 */
export function renameView(
	doc: LayerDoc,
	viewId: string,
	name: string,
): boolean {
	const trimmed = name.trim();
	if (trimmed === '') {
		return false;
	}
	const view = doc.views.find((candidate) => candidate.id === viewId);
	if (!view) {
		return false;
	}
	view.name = trimmed;
	return true;
}