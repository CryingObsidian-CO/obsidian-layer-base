/**
 * The expression language for `formula` fields: numbers, strings and booleans only, and nothing in
 * it can reach the vault, the DOM or the plugin, so a stored formula is safe to run on load.
 */

export type FormulaValue = number | string | boolean;

export type Token =
	| { kind: 'number'; value: number; at: number }
	| { kind: 'string'; value: string; at: number }
	/** `braced` marks the `{...}` form, which is always a column reference; a bare `TRUE` is a boolean. */
	| { kind: 'name'; value: string; at: number; braced?: boolean }
	| { kind: 'op'; value: string; at: number }
	| { kind: 'end'; at: number };

/**
 * Only a code and the values worth naming, never a sentence: the engine does not know which
 * language the reader uses, so the wording belongs to the caller (`formulaErrorMessage`).
 */
export interface FormulaError {
	code: string;
	detail?: string;
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
	 * A lone `=` is equality as a spreadsheet writes it; the two-character forms are matched first,
	 * and the leading `=` of a formula is dropped before lexing, so it never reaches here.
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

/** A failure is returned rather than thrown: a half-typed formula is a normal state while the editor is open. */
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

		// A `{field}` reference may contain spaces or dots, which a bare name cannot, so it is read as one unit.
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
