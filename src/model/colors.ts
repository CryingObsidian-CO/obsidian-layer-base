import type { ColorRule, Field, GridView, LayerRecord } from '../types';
import {
	matchesCondition,
	type CellTextResolver,
	type RelationTextResolver,
} from './filter';
import { optionColorHex } from './select-options';

/**
 * How much of the row's colour a tint shows.
 *
 * Low enough that the text stays the reader's own colour in either theme: a
 * stronger wash turns a coloured row into a coloured table.
 */
const TINT_ALPHA = 0.14;

/** The rules a view colours its rows by, in the order they are tried. */
export function colorRulesOf(view: GridView): readonly ColorRule[] {
	return view.colorRules ?? [];
}

/**
 * The colour a row wears, or null when no rule matches.
 *
 * Only the first match counts. A row is one colour, so a later rule must not be
 * able to paint over an earlier one: the order of the list then means exactly
 * "which rule wins", and nothing else.
 */
export function rowColorOf(
	view: GridView,
	record: LayerRecord,
	fields: readonly Field[],
	resolveRelation?: RelationTextResolver,
	cellText?: CellTextResolver,
): string | null {
	for (const rule of colorRulesOf(view)) {
		const field = fields.find((candidate) => candidate.id === rule.fieldId);
		// A rule naming a column that is gone cannot match anything.
		if (!field) {
			continue;
		}
		if (matchesCondition(field, record, rule, resolveRelation, cellText)) {
			return rule.color;
		}
	}
	return null;
}

/** Stores the rules, dropping the key when none are left. */
export function setColorRules(
	view: GridView,
	rules: readonly ColorRule[],
): void {
	if (rules.length === 0) {
		delete view.colorRules;
		return;
	}
	view.colorRules = rules.map((rule) => ({ ...rule }));
}

/** A palette colour as a see-through wash, for a row's background. */
export function rowTint(color: string): string {
	const hex = optionColorHex(color);
	const red = Number.parseInt(hex.slice(1, 3), 16);
	const green = Number.parseInt(hex.slice(3, 5), 16);
	const blue = Number.parseInt(hex.slice(5, 7), 16);
	return `rgba(${red}, ${green}, ${blue}, ${TINT_ALPHA})`;
}
