import type { Field, View } from '../types';

/**
 * Which columns a view shows.
 *
 * A view is a way of looking at the table, so hiding a column hides it for that view
 * only: the data and the other views are untouched. The last visible column cannot be
 * hidden — a table with no columns has nothing to draw.
 */

/** Whether a column is hidden in this view. */
export function isHidden(view: View, fieldId: string): boolean {
	return view.hiddenFieldIds.includes(fieldId);
}

/** How many columns are left visible. */
export function visibleCount(
	fields: readonly Field[],
	view: View,
): number {
	const hidden = new Set(view.hiddenFieldIds);
	return fields.filter((field) => !hidden.has(field.id)).length;
}

/**
 * Hides or shows a column in this view, answering whether it changed.
 *
 * Refuses to hide the last visible column: the table would have nothing left to
 * draw, and there is no way back from a table with no columns in it.
 */
export function setHidden(
	view: View,
	field: Field,
	fields: readonly Field[],
	hidden: boolean,
): boolean {
	if (hidden) {
		if (visibleCount(fields, view) <= 1) {
			return false;
		}
		if (view.hiddenFieldIds.includes(field.id)) {
			return false;
		}
		view.hiddenFieldIds = [...view.hiddenFieldIds, field.id];
		return true;
	}
	if (!view.hiddenFieldIds.includes(field.id)) {
		return false;
	}
	view.hiddenFieldIds = view.hiddenFieldIds.filter((id) => id !== field.id);
	return true;
}
