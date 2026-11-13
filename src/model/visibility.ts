import type { Field, View } from '../types';

/** Hiding a column is per view; the data and the other views are untouched. The last visible column
 * cannot be hidden — a table with no columns has nothing to draw. */

export function isHidden(view: View, fieldId: string): boolean {
	return view.hiddenFieldIds.includes(fieldId);
}

export function visibleCount(
	fields: readonly Field[],
	view: View,
): number {
	const hidden = new Set(view.hiddenFieldIds);
	return fields.filter((field) => !hidden.has(field.id)).length;
}

export type HiddenChange = 'changed' | 'unchanged' | 'refused';

/** Hides or shows a column. Already in that state answers `unchanged`; `refused` only means the last
 * visible column cannot be hidden. The caller shows a message on a refusal, so the two must differ. */
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
