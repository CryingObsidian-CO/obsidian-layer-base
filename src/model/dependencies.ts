import type { Field, LayerDoc } from '../types';
import { fieldsUsed, parseFormula } from './formula/parser';

/**
 * The columns an edit to `field` makes stale.
 *
 * A value is read from beside it: a lookup or a rollup gathers through the link
 * column it names, a note property reads through the note column it names, and a
 * formula names its column outright. A chain counts too — a formula reading a
 * rollup that gathers through this column is stale the moment this column moves —
 * so the answer is taken to a fixed point rather than asked in one step.
 *
 * An auto number grouped by this column is included for a different reason: the
 * row moves into another numbering sequence and is handed a new number, so that
 * cell goes stale as well.
 *
 * Lives here rather than in the view so it can be unit tested: the grid imports
 * `obsidian`, which ships types only.
 */
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

/** Whether `other` shows a value that comes from `source`. */
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

/**
 * Whether a formula names this column.
 *
 * Formulas read by name, and the first column carrying a name is the one that
 * answers — so a second column of the same name is read by nobody, and editing it
 * changes nothing.
 */
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
