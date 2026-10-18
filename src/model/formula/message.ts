import type { FormulaError } from './lexer';
import { FORMULA_FUNCTIONS, FORMULA_SYMBOL_GROUPS } from './eval';

/**
 * Which locale key a formula error reads by.
 *
 * This layer never produces prose: it cannot import the locale files, because
 * those reach `obsidian` and this module has to stay testable. So it names the key
 * and the caller looks it up — which is also what makes a missing translation a
 * visible fallback rather than a crash.
 */
export interface FormulaErrorKey {
	/** The locale key holding the sentence. */
	key: string;
	/** The value the sentence names, when it names one. */
	detail?: string;
}

const KEY_BY_CODE: Record<string, string> = {
	empty: 'formulaErrEmpty',
	'unclosed-reference': 'formulaErrUnclosedReference',
	'empty-reference': 'formulaErrEmptyReference',
	'unclosed-string': 'formulaErrUnclosedString',
	'bad-number': 'formulaErrBadNumber',
	'unexpected-character': 'formulaErrUnexpectedCharacter',
	'unexpected-token': 'formulaErrUnexpectedToken',
	'trailing-text': 'formulaErrTrailingText',
	'unclosed-paren': 'formulaErrUnclosedParen',
	'bad-arguments': 'formulaErrBadArguments',
	'not-a-number': 'formulaErrNotANumber',
	'not-a-date': 'formulaErrNotADate',
	'divide-by-zero': 'formulaErrDivideByZero',
	'modulo-by-zero': 'formulaErrModuloByZero',
	'unknown-field': 'formulaErrUnknownField',
	'unknown-function': 'formulaErrUnknownFunction',
	'bad-arity': 'formulaErrBadArity',
	'unknown-operator': 'formulaErrUnknownOperator',
	'bad-digits': 'formulaErrBadDigits',
	cycle: 'formulaErrCycle',
	'too-deep': 'formulaErrTooDeep',
};

/**
 * The kind of mistake a formula made, for a cell too narrow to explain itself.
 *
 * A code like `trailing-text` means nothing to a reader; what they need at a
 * glance is whether the formula is misspelled, points at something missing, or
 * cannot be computed — and the full sentence is one hover away.
 */
export type FormulaErrorKind = 'syntax' | 'reference' | 'math' | 'cycle';

const KIND_BY_CODE: Record<string, FormulaErrorKind> = {
	empty: 'syntax',
	'unclosed-reference': 'syntax',
	'empty-reference': 'syntax',
	'unclosed-string': 'syntax',
	'unexpected-character': 'syntax',
	'unexpected-token': 'syntax',
	'trailing-text': 'syntax',
	'unclosed-paren': 'syntax',
	'bad-arguments': 'syntax',
	'bad-number': 'syntax',
	'unknown-field': 'reference',
	'unknown-function': 'reference',
	'bad-arity': 'reference',
	'not-a-number': 'math',
	'not-a-date': 'math',
	'divide-by-zero': 'math',
	'modulo-by-zero': 'math',
	'bad-digits': 'math',
	'unknown-operator': 'syntax',
	cycle: 'cycle',
	'too-deep': 'cycle',
};

/** The locale key a mistake's short label reads by. */
export function formulaErrorKindKey(error: FormulaError): string {
	const kind = KIND_BY_CODE[error.code] ?? 'syntax';
	return `formulaErrShort${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}

/** The key a formula error reads by, falling back to a generic sentence. */
export function formulaErrorKey(error: FormulaError): FormulaErrorKey {
	const key = KEY_BY_CODE[error.code];
	if (key === undefined) {
		return { key: 'formulaErrGeneric' };
	}
	return error.detail === undefined ? { key } : { key, detail: error.detail };
}
/**
 * The key explaining what a built-in function does, for its tooltip.
 *
 * Derived from the name rather than listed per function: the locale key is always
 * `formulaFn` plus the name with a capital first letter, so adding a function to
 * the engine only needs its sentence added to the locale files — there is no
 * second table here to forget to update.
 */
export function formulaFunctionKey(name: string): string | null {
	const upper = name.toUpperCase();
	if (!FORMULA_FUNCTIONS.includes(upper)) {
		return null;
	}
	return `formulaFn${upper.charAt(0)}${upper.slice(1).toLowerCase()}`;
}

/**
 * The key explaining what a symbol does, for its tooltip.
 *
 * Found by looking through the groups rather than by a table kept here: a symbol
 * and the wording for it are declared together, so a new symbol cannot be added
 * without its sentence going in beside it.
 */
export function formulaSymbolKey(symbol: string): string | null {
	for (const group of FORMULA_SYMBOL_GROUPS) {
		for (const entry of group.symbols) {
			if (entry.symbol === symbol) {
				return entry.hintKey;
			}
		}
	}
	return null;
}