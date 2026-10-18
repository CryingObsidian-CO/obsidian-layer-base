import { describe, expect, it } from 'vitest';
import { tokenize } from '../src/model/formula/lexer';
import { parseFormula } from '../src/model/formula/parser';

/** Parses and reports only whether it worked, which is most of these tests. */
function parses(source: string): boolean {
	return parseFormula(source).ok;
}

function errorCode(source: string): string {
	const result = parseFormula(source);
	return result.ok ? '' : result.error.code;
}

describe('boolean literals', () => {
	/** The parsed kind of a formula that holds a single value. */
	function kindOf(source: string): string {
		const result = parseFormula(source);
		return result.ok ? result.node.kind : `error:${result.error.code}`;
	}

	it('reads a bare TRUE or FALSE as the value itself', () => {
		expect(kindOf('TRUE')).toBe('boolean');
		expect(kindOf('false')).toBe('boolean');
	});

	it('reads the braced form as a column, whatever it is called', () => {
		// A table may well have a column named TRUE, and `{TRUE}` must reach it.
		expect(kindOf('{TRUE}')).toBe('field');
		expect(kindOf('{true}')).toBe('field');
	});

	it('still reads a call as a call', () => {
		expect(kindOf('AND(TRUE)')).toBe('call');
	});

	it('keeps the word available inside a larger expression', () => {
		expect(parses('IF(TRUE, 1, 2)')).toBe(true);
		expect(parses('AND(TRUE, FALSE)')).toBe(true);
	});
});

describe('tokenize', () => {
	it('reads numbers, names, operators and text', () => {
		const result = tokenize('1 + abc * "hi"');
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.tokens.map((token) => token.kind)).toEqual([
			'number',
			'op',
			'name',
			'op',
			'string',
			'end',
		]);
	});

	it('reads a braced name as one reference, spaces included', () => {
		const result = tokenize('{Unit price} * 2');
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.tokens[0]).toMatchObject({ kind: 'name', value: 'Unit price' });
	});

	it('accepts Chinese names', () => {
		const result = tokenize('{标题}');
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.tokens[0]).toMatchObject({ kind: 'name', value: '标题' });
	});

	it('reads a decimal without a leading zero', () => {
		const result = tokenize('.5');
		expect(result.ok).toBe(true);
		if (!result.ok) {
			return;
		}
		expect(result.tokens[0]).toMatchObject({ kind: 'number', value: 0.5 });
	});

	it('reports an unclosed reference', () => {
		const result = tokenize('{title');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('unclosed-reference');
		}
	});

	it('reports an unclosed string', () => {
		const result = tokenize('"hi');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('unclosed-string');
		}
	});

	it('reports a character it cannot read', () => {
		const result = tokenize('1 $ 2');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('unexpected-character');
			expect(result.error.at).toBe(2);
		}
	});
});

describe('parseFormula', () => {
	it('accepts a bare value', () => {
		expect(parses('42')).toBe(true);
		expect(parses('"text"')).toBe(true);
		expect(parses('{field}')).toBe(true);
	});

	it('accepts arithmetic with precedence', () => {
		expect(parses('1 + 2 * 3')).toBe(true);
		expect(parses('(1 + 2) * 3')).toBe(true);
	});

	it('accepts function calls, including none with no arguments', () => {
		expect(parses('SUM(1, 2, 3)')).toBe(true);
		expect(parses('CONCAT("a", "b")')).toBe(true);
	});

	it('accepts comparisons chained with arithmetic', () => {
		expect(parses('1 + 2 > 2')).toBe(true);
		expect(parses('{a} == {b}')).toBe(true);
	});

	it('ignores a leading equals sign', () => {
		expect(parses('=1 + 2')).toBe(true);
	});

	it('reports an empty formula', () => {
		expect(errorCode('')).toBe('empty');
		expect(errorCode('   ')).toBe('empty');
		expect(errorCode('=')).toBe('empty');
	});

	it('reports a missing closing parenthesis', () => {
		expect(errorCode('(1 + 2')).toBe('unclosed-paren');
	});

	it('reports trailing text it cannot use', () => {
		// A separate code from `unexpected-token`, so the message can name which
		// problem it is.
		expect(errorCode('1 + 2 3')).toBe('trailing-text');
	});

	it('reports a call whose arguments are not separated properly', () => {
		expect(errorCode('SUM(1 2)')).toBe('bad-arguments');
	});

	it('reports a value used where an operator is expected', () => {
		expect(errorCode('1 1')).toBe('trailing-text');
	});
});