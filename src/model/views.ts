import type { Field, KanbanView, LayerDoc, View } from '../types';
import { isDerived } from './fields';

/** Adding and removing views touches only `doc.views`; rows and columns stay untouched. */

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
 * Prefers a choice column, then any plain single-valued one; a computed column can be grouped
 * but its cards cannot be dragged.
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

/** Null when there is no column to group by — a board without one has nothing to draw. */
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

/** The table view cannot be removed: every other view looks at the rows through it. */
export function removeView(doc: LayerDoc, viewId: string): boolean {
	const index = doc.views.findIndex((view) => view.id === viewId);
	if (index === -1) {
		return false;
	}
	const view = doc.views[index];
	if (view === undefined || !canRemoveView(view)) {
		return false;
	}
	// A table is always present, so this only guards a hand-edited file.
	if (doc.views.length <= 1) {
		return false;
	}
	doc.views.splice(index, 1);
	return true;
}

export function canRemoveView(view: View): boolean {
	return view.type !== 'grid';
}

/** A blank name is refused; duplicates are allowed — tabs are told apart by their icon. */
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