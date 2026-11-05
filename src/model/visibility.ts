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

/** What asking to hide or show a column came to. */
export type HiddenChange = 'changed' | 'unchanged' | 'refused';

/**
 * Hides or shows a column in this view.
 *
 * Asked for the state the column is already in, it is left alone and answers
 * `unchanged` — that is not a refusal, and there is nothing to tell the reader
 * about. Only `refused` means the request was turned down, which happens for one
 * reason: the last visible column cannot be hidden, because a table with nothing
 * left to draw has no way to reach a column again.
 *
 * The two are told apart because the caller shows a message on a refusal, and
 * "the last visible column cannot be hidden" over a column that was already hidden
 * reads as a broken button.
 */
export function setHidden(
	view: View,
	field: Field,
	fields: readonly Field[],
	hidden: boolean,
): HiddenChange {
	if (view.hiddenFieldIds.includes(field.id) === hidden) {
		return 'unchanged';
	}
	if (hidden && visibleCount(fields, view) <= 1) {
		return 'refused';
	}
	view.hiddenFieldIds = hidden
		? [...view.hiddenFieldIds, field.id]
		: view.hiddenFieldIds.filter((id) => id !== field.id);
	return 'changed';
}
