import type { ColorRule, Field, GridView, LayerRecord } from '../types';
import {
	matchesCondition,
	type CellTextResolver,
	type RelationTextResolver,
} from './filter';
import { optionColorHex } from './select-options';

/** Low enough that text keeps the theme's own colour; a stronger wash turns a row into a coloured table. */
const TINT_ALPHA = 0.14;

export function colorRulesOf(view: GridView): readonly ColorRule[] {
	return view.colorRules ?? [];
}

/** The colour the first matching rule gives, or null. A row is one colour, so list order is the priority. */
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

export function rowTint(color: string): string {
	const hex = optionColorHex(color);
	const red = Number.parseInt(hex.slice(1, 3), 16);
	const green = Number.parseInt(hex.slice(3, 5), 16);
	const blue = Number.parseInt(hex.slice(5, 7), 16);
	return `rgba(${red}, ${green}, ${blue}, ${TINT_ALPHA})`;
}
