import type { CellValue, Field, LayerDoc, LayerRecord } from '../../types';
import { formatCell } from '../fields';
import { evaluate, toBoolean, toText, type FormulaContext } from './eval';
import type { FormulaError, FormulaValue } from './lexer';
import { parseFormula } from './parser';

/* The value types are part of this module's surface: a reader answers with one. */
export type { FormulaError, FormulaValue } from './lexer';

export type FormulaResult =
	| {
			ok: true;
			text: string;
			/**
			 * Carried beside the text so a number stays a number: `+` joins text, so a total read
			 * back as "42" would become "421".
			 */
			value: FormulaValue;
			kind: FormulaValueKind;
			/** Carried so a column told to show a box has a rule to follow, whatever the value's kind. */
			truthy: boolean;
	  }
	| { ok: false; error: FormulaError };

/** Carried back with the text so a total lines up on the right and a condition shows a tick. */
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

function cellAsFormulaValue(field: Field, value: CellValue): FormulaValue {
	// A number column contributes its number rather than the text it is dressed in, so arithmetic stays arithmetic.
	if (typeof value === 'number') {
		return value;
	}
	if (typeof value === 'boolean') {
		return value;
	}
	// Everything else reads as the text the grid shows, which is how a relation contributes its names.
	return formatCell(field, value);
}

/** Parsed forms, kept because parsing is not free. */
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

/** Test-only: clears the parse cache. */
export function forgetParsedFormulas(): void {
	parseCache.clear();
}
/** Depth bound on formula-references-formula chains; a cycle would otherwise recurse forever. */
const MAX_CHAIN = 32;

/**
 * Reads a column the document cannot answer for itself: a relation holds row ids where the grid
 * shows names, and computed columns hold nothing. `undefined` means the document reads it fine.
 */
export type FormulaCellReader = (field: Field) => FormulaValue | undefined;

/**
 * Failure is carried back rather than turned into text, so a formula reading a broken formula is
 * itself broken.
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
	// Read from the caller first: a relation stores ids where names are shown, and computed columns store nothing.
	const fromCaller = readCell?.(field);
	if (fromCaller !== undefined) {
		return { value: fromCaller };
	}
	return { value: cellAsFormulaValue(field, record.cells[field.id] ?? '') };
}

/**
 * `seen` is the chain of formula columns being resolved, so a repeat is the cycle; without
 * `readCell` a column whose value lives on the view reads as empty rather than as row ids.
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

	// Fields are named as typed in the formula; the first column with a matching name wins, as the editor lists them.
	const byName = new Map<string, Field>();
	for (const candidate of doc.fields) {
		if (!byName.has(candidate.name)) {
			byName.set(candidate.name, candidate);
		}
	}

	// A reference to a failed formula fails this one too, rather than contributing a placeholder.
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

export function computeFormulaWithReader(
	doc: LayerDoc,
	record: LayerRecord,
	field: Field,
	readCell: FormulaCellReader,
	now: Date = new Date(),
): FormulaResult {
	return computeFormula(doc, record, field, 0, new Set(), now, readCell);
}
