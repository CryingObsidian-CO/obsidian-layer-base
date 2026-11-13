import type { FormulaError } from './lexer';
import { FORMULA_FUNCTIONS, FORMULA_SYMBOL_GROUPS } from './eval';

/**
 * This layer names a locale key instead of prose: importing the locale files would drag in
 * `obsidian`, and a missing translation then shows a fallback rather than crashing.
 */
export interface FormulaErrorKey {
	key: string;
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

/** A code the cell shows at a glance; the full sentence is one hover away. */
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

export function formulaErrorKindKey(error: FormulaError): string {
	const kind = KIND_BY_CODE[error.code] ?? 'syntax';
	return `formulaErrShort${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}

export function formulaErrorKey(error: FormulaError): FormulaErrorKey {
	const key = KEY_BY_CODE[error.code];
	if (key === undefined) {
		return { key: 'formulaErrGeneric' };
	}
	return error.detail === undefined ? { key } : { key, detail: error.detail };
}
/**
 * Derived from the name, not a table: adding a function only needs its locale sentence, never a
 * second list here.
 */
export function formulaFunctionKey(name: string): string | null {
	const upper = name.toUpperCase();
	if (!FORMULA_FUNCTIONS.includes(upper)) {
		return null;
	}
	return `formulaFn${upper.charAt(0)}${upper.slice(1).toLowerCase()}`;
}

/** Found through the symbol groups, where a symbol and its hint are declared together. */
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