import type { FieldType } from '../types';

/** One row of the type picker: what it shows, and what it hands back. */
export interface FieldTypeChoice {
	type: FieldType;
	label: string;
	hint: string;
}

/** Whether a choice matches a search query. The label only, never the hint. */
export function fieldTypeMatches(
	choice: FieldTypeChoice,
	query: string,
): boolean {
	const needle = query.trim().toLowerCase();
	if (!needle) {
		return true;
	}
	return choice.label.toLowerCase().includes(needle);
}