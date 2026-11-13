import type { Field, LayerDoc } from '../types';
import { fieldsUsed, parseFormula } from './formula/parser';

/** The columns an edit to `field` makes stale: anything that reads it, directly or through a chain,
 * plus auto-number columns grouped by it. Lives here, not in the grid, because the grid imports
 * `obsidian`, which ships types only. */
export function affectedByEdit(doc: LayerDoc, field: Field): Field[] {
	const stale = new Set<string>();
	let frontier: Field[] = [field];
	while (frontier.length > 0) {
		const next: Field[] = [];
		for (const source of frontier) {
			for (const other of doc.fields) {
				if (other.id === field.id || stale.has(other.id)) {
					continue;
				}
				const numberedHere =
					other.type === 'autoNumber' && other.numberGroupFieldId === source.id;
				if (!numberedHere && !readsColumn(doc, other, source)) {
					continue;
				}
				stale.add(other.id);
				next.push(other);
			}
		}
		frontier = next;
	}
	// In column order, so the repaint runs left to right as the reader sees it.
	return doc.fields.filter((other) => stale.has(other.id));
}

function readsColumn(doc: LayerDoc, other: Field, source: Field): boolean {
	switch (other.type) {
		case 'lookup':
			return other.lookupSourceFieldId === source.id;
		case 'rollup':
			return other.rollupSourceFieldId === source.id;
		case 'noteProp':
			return other.noteFieldId === source.id;
		case 'formula':
			return formulaReads(doc, other, source);
		default:
			return false;
	}
}

/** Whether a formula names this column. Formulas read by name, and the first column carrying a name
 * answers, so a second column of the same name is read by nobody. */
function formulaReads(doc: LayerDoc, formula: Field, source: Field): boolean {
	const expression = formula.formula ?? '';
	if (expression.trim() === '') {
		return false;
	}
	const parsed = parseFormula(expression);
	if (!parsed.ok || !fieldsUsed(parsed.node).has(source.name)) {
		return false;
	}
	return doc.fields.find((other) => other.name === source.name)?.id === source.id;
}
