import type { CellValue, Field, LayerDoc, LayerRecord } from '../../types';
import { formatCell } from '../fields';
import { evaluate, toBoolean, toText, type FormulaContext } from './eval';
import type { FormulaError, FormulaValue } from './lexer';
import { parseFormula } from './parser';

/* The value types are part of this module's surface: a reader answers with one. */
export type { FormulaError, FormulaValue } from './lexer';

/** What one formula cell resolved to. */
export type FormulaResult =
	| {
			ok: true;
			text: string;
			/**
			 * The value itself. Carried beside its text so a formula that reads this
			 * one keeps a number a number: `+` joins text, so a total handed on as
			 * "42" would read back as "421" once one was added to it.
			 */
			value: FormulaValue;
			kind: FormulaValueKind;
			/**
			 * What the value means as a yes or no. Carried so a column told to show
			 * a box has a rule to follow, whatever the value's own kind is.
			 */
			truthy: boolean;
	  }
	| { ok: false; error: FormulaError };

/**
 * The kind of value a formula produced.
 *
 * Carried back with the text so the cell can present it as what it is: a total
 * lines up on the right, a condition shows a tick. Without it every result would
 * be a string, and a column of figures would read like a column of words.
 */
export type FormulaValueKind = 'number' | 'text' | 'boolean';

function valueKind(value: FormulaValue): FormulaValueKind {
	if (typeof value === 'number') {
		return 'number';
	}
	if (typeof value === 'boolean') {
		return 'boolean';
	}
	return 'text';
}

/** The text a cell of some field shows, as a formula sees it. */
function cellAsFormulaValue(field: Field, value: CellValue): FormulaValue {
	// A number column contributes its number rather than the text it is dressed in,
	// so arithmetic on it stays arithmetic.
	if (typeof value === 'number') {
		return value;
	}
	if (typeof value === 'boolean') {
		return value;
	}
	// Everything else reads as the text the grid already shows, which is how a
	// relation column contributes the names it points at.
	return formatCell(field, value);
}

/** The parsed form of each field's formula, kept because parsing is not free. */
const parseCache = new Map<string, ReturnType<typeof parseFormula>>();

function parseOnce(source: string): ReturnType<typeof parseFormula> {
	const cached = parseCache.get(source);
	if (cached) {
		return cached;
	}
	const parsed = parseFormula(source);
	parseCache.set(source, parsed);
	return parsed;
}

/** Clears the parse cache; only the tests need it. */
export function forgetParsedFormulas(): void {
	parseCache.clear();
}
/**
 * How deep a chain of formulas may refer to each other.
 *
 * A formula that reads another formula is fine — the chain is resolved row by
 * row — but a cycle would recurse forever, so depth is counted and refused
 * beyond a bound that no honest sheet would reach.
 */
const MAX_CHAIN = 32;

/**
 * Reads a column the document cannot answer for itself.
 *
 * A relation stores the ids of the rows it points at where the grid shows their
 * names, and a lookup, rollup or reverse relation stores nothing at all, so what
 * those columns read as lives on the view's side, which is the only side that can
 * open the other table. Answering `undefined` means "this one the document reads
 * correctly on its own".
 */
export type FormulaCellReader = (field: Field) => FormulaValue | undefined;

/** The value a formula column contributes to another formula, plus whether it could
 * be computed at all.
 *
 * The failure is carried back rather than turned into text, so a chain cannot end
 * up reporting success after one of its links failed: a formula reading a broken
 * formula is itself broken.
 */
function resolveField(
	doc: LayerDoc,
	record: LayerRecord,
	field: Field,
	depth: number,
	seen: ReadonlySet<string>,
	now: Date,
	readCell?: FormulaCellReader,
): { value: FormulaValue; error?: FormulaError } {
	if (field.type === 'formula') {
		const result = computeFormula(doc, record, field, depth + 1, seen, now, readCell);
		if (!result.ok) {
			return { value: '', error: result.error };
		}
		return { value: result.value };
	}
	/*
	 * Asked before the stored cell is read, because for some types the stored cell
	 * is not what the reader sees: a relation hands over its ids, and a computed
	 * column has nothing stored at all.
	 */
	const fromCaller = readCell?.(field);
	if (fromCaller !== undefined) {
		return { value: fromCaller };
	}
	return { value: cellAsFormulaValue(field, record.cells[field.id] ?? '') };
}

/**
 * Computes one formula cell.
 *
 * `seen` carries the chain of formula columns being resolved; a column already in
 * it is the cycle, and is reported as such instead of recursing. `readCell` is
 * there for the columns whose value lives outside the document; without it they
 * read as empty rather than as a column of row ids.
 */
export function computeFormula(
	doc: LayerDoc,
	record: LayerRecord,
	field: Field,
	depth = 0,
	seen: ReadonlySet<string> = new Set(),
	now: Date = new Date(),
	readCell?: FormulaCellReader,
): FormulaResult {
	if (depth > MAX_CHAIN) {
		return {
			ok: false,
			error: { code: 'too-deep' },
		};
	}
	if (seen.has(field.id)) {
		return {
			ok: false,
			error: { code: 'cycle' },
		};
	}

	const source = field.formula ?? '';
	if (source.trim() === '') {
		return { ok: false, error: { code: 'empty' } };
	}

	const parsed = parseOnce(source);
	if (!parsed.ok) {
		return { ok: false, error: parsed.error };
	}

	const nextSeen = new Set(seen);
	nextSeen.add(field.id);

	/*
	 * Fields are named by their display name rather than their id, because that
	 * is what a person types into the formula. The first column with a matching
	 * name wins, which is the same rule the editor lists them by.
	 */
	const byName = new Map<string, Field>();
	for (const candidate of doc.fields) {
		if (!byName.has(candidate.name)) {
			byName.set(candidate.name, candidate);
		}
	}

	/*
	 * A reference to a formula that failed makes THIS formula fail too. The error
	 * is collected here and returned as the whole result, rather than letting the
	 * failed link contribute a placeholder and the outer formula report success.
	 */
	let nestedError: FormulaError | null = null;

	const context: FormulaContext = {
		hasField: (name) => byName.has(name),
		field: (name) => {
			const target = byName.get(name);
			if (!target) {
				return undefined;
			}
			const resolved = resolveField(
				doc,
				record,
				target,
				depth,
				nextSeen,
				now,
				readCell,
			);
			if (resolved.error) {
				nestedError ??= resolved.error;
				return '';
			}
			return resolved.value;
		},
		now,
	};

	const evaluated = evaluate(parsed.node, context);
	if (nestedError) {
		return { ok: false, error: nestedError };
	}
	if (!evaluated.ok) {
		return { ok: false, error: evaluated.error };
	}
	return {
		ok: true,
		text: toText(evaluated.value),
		value: evaluated.value,
		kind: valueKind(evaluated.value),
		truthy: toBoolean(evaluated.value),
	};
}

/**
 * Computes one formula cell, with a reader for the columns the document cannot
 * answer for itself.
 *
 * The positional form of `computeFormula` exists for the engine's own recursion
 * and for tests that only need a fixed "now"; this one names the argument the
 * view actually has, so a call site does not have to spell out empty defaults.
 */
export function computeFormulaWithReader(
	doc: LayerDoc,
	record: LayerRecord,
	field: Field,
	readCell: FormulaCellReader,
	now: Date = new Date(),
): FormulaResult {
	return computeFormula(doc, record, field, 0, new Set(), now, readCell);
}
