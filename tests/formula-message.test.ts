import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/model/formula/lexer';
import { parseFormula } from '../src/model/formula/parser';
import { computeFormula } from '../src/model/formula';
import {
	formulaErrorKey,
	formulaErrorKindKey,
	formulaFunctionKey,
	formulaSymbolKey,
} from '../src/model/formula/message';
import {
	FORMULA_FUNCTION_GROUPS,
	FORMULA_FUNCTIONS,
	FORMULA_SYMBOL_GROUPS,
} from '../src/model/formula/eval';
import { createEmptyDoc } from '../src/io/schema';
import { addRecord } from '../src/model/records';

/** Every error code a formula can report, gathered by provoking each one. */
function errorOf(source: string): {
	code: string;
	detail?: string;
	message?: string;
} {
	const lexed = tokenize(source);
	if (!lexed.ok) {
		return lexed.error;
	}
	const parsed = parseFormula(source);
	if (!parsed.ok) {
		return parsed.error;
	}
	const doc = createEmptyDoc('Board');
	doc.fields = [
		{ id: 'f', name: 'f', type: 'formula', formula: source, primary: true },
	];
	const record = addRecord(doc);
	const result = computeFormula(doc, record, doc.fields[0]!);
	if (result.ok) {
		throw new Error(`expected a failure for ${source}`);
	}
	return result.error;
}

/** The sources that provoke one error each, with the code each must report. */
const CASES: readonly (readonly [string, string])[] = [
	['', 'empty'],
	['{a', 'unclosed-reference'],
	['{}', 'empty-reference'],
	['"a', 'unclosed-string'],
	['1 $ 2', 'unexpected-character'],
	['(1', 'unclosed-paren'],
	['1 +', 'unexpected-token'],
	['1 2', 'trailing-text'],
	['SUM(1 2)', 'bad-arguments'],
	['1 / 0', 'divide-by-zero'],
	['1 % 0', 'modulo-by-zero'],
	['{nope}', 'unknown-field'],
	['NOPE(1)', 'unknown-function'],
	['ROUND(1, 99)', 'bad-digits'],
];

describe('the engine reports codes, not sentences', () => {
	it('names each failure with a stable code', () => {
		for (const [source, code] of CASES) {
			expect(errorOf(source).code, source).toBe(code);
		}
	});

	it('carries no English sentence in the error itself', () => {
		for (const [source] of CASES) {
			// A message field would mean wording the engine cannot localise.
			expect(errorOf(source).message, source).toBeUndefined();
		}
	});

	it('keeps the offending value as a detail where it helps', () => {
		expect(errorOf('{nope}').detail).toBe('nope');
		expect(errorOf('NOPE(1)').detail).toBe('NOPE');
		expect(errorOf('1 $ 2').detail).toBe('$');
	});
});

describe('formulaErrorKey', () => {
	it('gives every code the engine can produce a locale key', () => {
		for (const [source] of CASES) {
			const { key } = formulaErrorKey(errorOf(source));
			expect(key.startsWith('formulaErr'), source).toBe(true);
			// Never the generic one while the specific code is known.
			expect(key, source).not.toBe('formulaErrGeneric');
		}
	});

	it('passes the value along when the sentence names one', () => {
		expect(formulaErrorKey({ code: 'unknown-field', detail: 'nope' })).toEqual({
			key: 'formulaErrUnknownField',
			detail: 'nope',
		});
	});

	it('falls back to a generic key for a code it has never seen', () => {
		expect(formulaErrorKey({ code: 'brand-new-code' })).toEqual({
			key: 'formulaErrGeneric',
		});
	});
});

describe('formulaFunctionKey', () => {
	it('gives every offered function a key', () => {
		for (const name of FORMULA_FUNCTIONS) {
			const key = formulaFunctionKey(name);
			expect(key, name).not.toBeNull();
			expect(key?.startsWith('formulaFn'), name).toBe(true);
		}
	});

	it('answers null for a name it does not know', () => {
		expect(formulaFunctionKey('NOPE')).toBeNull();
	});
});

describe('formulaErrorKindKey', () => {
	it('names a kind for every code, and never the raw code', () => {
		const kinds = new Set([
			'formulaErrShortSyntax',
			'formulaErrShortReference',
			'formulaErrShortMath',
			'formulaErrShortCycle',
		]);
		for (const [source] of CASES) {
			const key = formulaErrorKindKey(errorOf(source));
			expect(kinds.has(key), `${source} → ${key}`).toBe(true);
		}
	});

	it('tells a misspelling from a missing reference from arithmetic', () => {
		// These are the distinctions worth drawing in a cell too narrow for a
		// sentence; the sentence itself travels as the hover.
		expect(formulaErrorKindKey({ code: 'trailing-text' })).toBe(
			'formulaErrShortSyntax',
		);
		expect(formulaErrorKindKey({ code: 'unknown-field' })).toBe(
			'formulaErrShortReference',
		);
		expect(formulaErrorKindKey({ code: 'divide-by-zero' })).toBe(
			'formulaErrShortMath',
		);
		expect(formulaErrorKindKey({ code: 'cycle' })).toBe('formulaErrShortCycle');
	});

	it('calls a code it has never seen a syntax problem', () => {
		expect(formulaErrorKindKey({ code: 'brand-new-code' })).toBe(
			'formulaErrShortSyntax',
		);
	});
});

describe('formulaSymbolKey', () => {
	it('gives every offered symbol a key', () => {
		for (const group of FORMULA_SYMBOL_GROUPS) {
			for (const entry of group.symbols) {
				const key = formulaSymbolKey(entry.symbol);
				expect(key, entry.symbol).toBe(entry.hintKey);
				expect(key?.startsWith('formulaSym'), entry.symbol).toBe(true);
			}
		}
	});

	it('answers null for a symbol it does not offer', () => {
		// A button can only be built from the declared groups, so this is the
		// safety net for a symbol passed in from somewhere else.
		expect(formulaSymbolKey('&&')).toBeNull();
		expect(formulaSymbolKey('')).toBeNull();
	});

	it('explains the symbols a reader cannot guess', () => {
		// The point of the wording: `!=`, `%` and a quote mean nothing to someone
		// who has not met them, which is exactly who the buttons are for.
		for (const symbol of ['!=', '%', '"', 'TRUE', 'FALSE', '>=']) {
			expect(formulaSymbolKey(symbol), symbol).not.toBeNull();
		}
	});
});

describe('the groups the functions are offered in', () => {
	it('cover every function exactly once', () => {
		// A function in no group would never be offered; one in two would appear
		// twice. Both are mistakes that only show on a screen nobody re-reads.
		const seen = new Map<string, number>();
		for (const group of FORMULA_FUNCTION_GROUPS) {
			for (const name of group.functions) {
				seen.set(name, (seen.get(name) ?? 0) + 1);
			}
		}
		for (const name of FORMULA_FUNCTIONS) {
			expect(seen.get(name), `${name} is grouped`).toBe(1);
		}
		expect(seen.size).toBe(FORMULA_FUNCTIONS.length);
	});

	it('name only functions that exist', () => {
		for (const group of FORMULA_FUNCTION_GROUPS) {
			for (const name of group.functions) {
				expect(FORMULA_FUNCTIONS, name).toContain(name);
			}
		}
	});

	it('each have a label key to be shown under', () => {
		for (const group of FORMULA_FUNCTION_GROUPS) {
			expect(group.labelKey.startsWith('formulaGroup'), group.labelKey).toBe(true);
			expect(group.functions.length).toBeGreaterThan(0);
		}
	});
});

describe('the text these keys point at', () => {
	/*
	 * The locale files themselves are checked by `npm run check:i18n`, because
	 * reading them here would need `node:fs`, which a mobile-safe plugin may not
	 * import. What can be asserted without them is the shape of the contract: a
	 * tooltip is a label, so the key naming one is distinct from the keys naming
	 * sentences, and the two sets do not overlap.
	 */
	it('separates tooltip keys from sentence keys', () => {
		for (const name of FORMULA_FUNCTIONS) {
			const key = formulaFunctionKey(name) as string;
			expect(key.startsWith('formulaFn'), key).toBe(true);
			// A message key would mean a tooltip and an error shared wording.
			expect(key.startsWith('formulaErr'), key).toBe(false);
		}
	});
});

