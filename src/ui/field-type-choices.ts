import type { FieldType } from '../types';

export interface FieldTypeChoice {
	type: FieldType;
	label: string;
	hint: string;
}

/** Matches the label only; the hint is not searched. */
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