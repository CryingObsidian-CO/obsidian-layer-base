/**
 * A small expression language for `formula` fields.
 *
 * Split into three stages — lexing, parsing, evaluation — so that each can be
 * tested on its own: the parser never evaluates, and the evaluator only ever
 * walks a tree it was handed.
 *
 * The language is deliberately closed: values are numbers, strings and booleans,
 * and nothing in it can reach the vault, the DOM or the plugin. That is what
 * makes a formula field safe to store in a file and run on load.
 */

/** What a formula may produce or combine. */
export type FormulaValue = number | string | boolean;

/** One token of the source text. */
export type Token =
	| { kind: 'number'; value: number; at: number }
	| { kind: 'string'; value: string; at: number }
	/**
	 * A name. `braced` marks the `{...}` form, which is always a column reference:
	 * a bare name may also be the word `TRUE`, but `{TRUE}` can only be a column.
	 */
	| { kind: 'name'; value: string; at: number; braced?: boolean }
	| { kind: 'op'; value: string; at: number }
	| { kind: 'end'; at: number };

/**
 * Where a formula went wrong.
 *
 * Only a code and the values worth naming, never a sentence: the engine does not
 * know which language the reader uses, so the wording belongs to the caller. See
 * `formulaErrorMessage` for the translation.
 */
export interface FormulaError {
	/** A short, stable reason such as `unknown-field` or `divide-by-zero`. */
	code: string;
	/** Pieces the message needs, such as the offending character or field name. */
	detail?: string;
	/** The offset in the source text the problem starts at, when known. */
	at?: number;
}

const OPERATORS = [
	'==',
	'!=',
	'<=',
	'>=',
	'+',
	'-',
	'*',
	'/',
	'%',
	'(',
	')',
	',',
	'<',
	'>',
	/*
	 * A lone `=` is equality, because that is what a spreadsheet writes and what
	 * someone who does not know this syntax will type. The two-character form is
	 * matched first, so `==`, `<=` and `>=` are unaffected — and the leading `=`
	 * of a formula is dropped before lexing, so it never reaches here.
	 */
	'=',
] as const;

/** Characters that may start and continue a bare name. */
function isNameStart(char: string): boolean {
	return /[A-Za-z_\u4e00-\u9fa5]/.test(char);
}

function isNamePart(char: string): boolean {
	return /[A-Za-z0-9_\u4e00-\u9fa5]/.test(char);
}

/**
 * Turns source text into tokens.
 *
 * A failure is returned rather than thrown, because a half-typed formula is a
 * normal state while the editor is open — the caller decides whether to report
 * it or wait.
 */
export function tokenize(
	source: string,
): { ok: true; tokens: Token[] } | { ok: false; error: FormulaError } {
	const tokens: Token[] = [];
	let at = 0;

	while (at < source.length) {
		const char = source[at] as string;

		if (/\s/.test(char)) {
			at++;
			continue;
		}

		// A `{field}` reference carries a name that may contain spaces or dots,
		// which a bare name cannot, so it is read as one unit.
		if (char === '{') {
			const close = source.indexOf('}', at + 1);
			if (close === -1) {
				return {
					ok: false,
					error: { code: 'unclosed-reference', at },
				};
			}
			const name = source.slice(at + 1, close).trim();
			if (name === '') {
				return {
					ok: false,
					error: { code: 'empty-reference', at },
				};
			}
			tokens.push({ kind: 'name', value: name, at, braced: true });
			at = close + 1;
			continue;
		}

		if (char === '"' || char === "'") {
			const quote = char;
			let value = '';
			let index = at + 1;
			let closed = false;
			while (index < source.length) {
				const inner = source[index] as string;
				if (inner === '\\' && index + 1 < source.length) {
					value += source[index + 1] ?? '';
					index += 2;
					continue;
				}
				if (inner === quote) {
					closed = true;
					index++;
					break;
				}
				value += inner;
				index++;
			}
			if (!closed) {
				return {
					ok: false,
					error: { code: 'unclosed-string', at },
				};
			}
			tokens.push({ kind: 'string', value, at });
			at = index;
			continue;
		}

		if (/[0-9]/.test(char) || (char === '.' && /[0-9]/.test(source[at + 1] ?? ''))) {
			let index = at;
			let seenDot = false;
			while (index < source.length) {
				const inner = source[index] as string;
				if (/[0-9]/.test(inner)) {
					index++;
					continue;
				}
				if (inner === '.' && !seenDot) {
					seenDot = true;
					index++;
					continue;
				}
				break;
			}
			const text = source.slice(at, index);
			const value = Number(text);
			if (!Number.isFinite(value)) {
				return {
					ok: false,
					error: { code: 'bad-number', detail: text, at },
				};
			}
			tokens.push({ kind: 'number', value, at });
			at = index;
			continue;
		}

		if (isNameStart(char)) {
			let index = at + 1;
			while (index < source.length && isNamePart(source[index] as string)) {
				index++;
			}
			tokens.push({
				kind: 'name',
				value: source.slice(at, index),
				at,
			});
			at = index;
			continue;
		}

		const two = source.slice(at, at + 2);
		const matched = OPERATORS.find((op) => op === two) ??
			OPERATORS.find((op) => op === char);
		if (matched === undefined) {
			return {
				ok: false,
				error: { code: 'unexpected-character', detail: char, at },
			};
		}
		tokens.push({ kind: 'op', value: matched, at });
		at += matched.length;
	}

	tokens.push({ kind: 'end', at: source.length });
	return { ok: true, tokens };
}
