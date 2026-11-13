import { tokenize, type FormulaError, type Token } from './lexer';

/** Every node keeps its source offset, so an error can point back at the text. */
export type FormulaNode =
	| { kind: 'number'; value: number; at: number }
	| { kind: 'string'; value: string; at: number }
	| { kind: 'boolean'; value: boolean; at: number }
	| { kind: 'field'; name: string; at: number }
	| { kind: 'call'; name: string; args: FormulaNode[]; at: number }
	| { kind: 'unary'; op: string; operand: FormulaNode; at: number }
	| { kind: 'binary'; op: string; left: FormulaNode; right: FormulaNode; at: number };

/**
 * Literals, not column names: `AND(TRUE, {done})` works without a column called TRUE, and the
 * braced `{TRUE}` still reaches a column of that name.
 */
const BOOLEANS: Record<string, boolean> = { TRUE: true, FALSE: false };

type ParseResult =
	| { ok: true; node: FormulaNode }
	| { ok: false; error: FormulaError };

/** Lowest first: a later entry binds more tightly. */
const PRECEDENCE: readonly (readonly string[])[] = [
	['==', '=', '!=', '<', '>', '<=', '>='],
	['+', '-'],
	['*', '/', '%'],
];

class Parser {
	private index = 0;

	constructor(private readonly tokens: readonly Token[]) {}

	private peek(): Token {
		return this.tokens[this.index] ?? { kind: 'end', at: 0 };
	}

	private next(): Token {
		const token = this.peek();
		this.index++;
		return token;
	}

	private atCall(): boolean {
		const token = this.peek();
		return token.kind === 'op' && token.value === '(';
	}

	parse(): ParseResult {
		if (this.peek().kind === 'end') {
			return {
				ok: false,
				error: { code: 'empty' },
			};
		}
		const node = this.parseExpression(0);
		if (!node.ok) {
			return node;
		}
		const trailing = this.peek();
		if (trailing.kind !== 'end') {
			return {
				ok: false,
				error: { code: 'trailing-text', at: trailing.at },
			};
		}
		return { ok: true, node: node.node };
	}

	/** Precedence climbing: each level only ever consumes what it binds tighter. */
	private parseExpression(level: number): ParseResult {
		if (level >= PRECEDENCE.length) {
			return this.parseUnary();
		}
		let left = this.parseExpression(level + 1);
		if (!left.ok) {
			return left;
		}
		const ops = PRECEDENCE[level] ?? [];
		for (;;) {
			const token = this.peek();
			if (token.kind !== 'op' || !ops.includes(token.value)) {
				return left;
			}
			this.next();
			const right = this.parseExpression(level + 1);
			if (!right.ok) {
				return right;
			}
			left = {
				ok: true,
				node: {
					kind: 'binary',
					op: token.value,
					left: left.node,
					right: right.node,
					at: token.at,
				},
			};
		}
	}

	private parseUnary(): ParseResult {
		const token = this.peek();
		if (token.kind === 'op' && (token.value === '-' || token.value === '+')) {
			this.next();
			const operand = this.parseUnary();
			if (!operand.ok) {
				return operand;
			}
			return {
				ok: true,
				node: {
					kind: 'unary',
					op: token.value,
					operand: operand.node,
					at: token.at,
				},
			};
		}
		return this.parsePrimary();
	}

	private parsePrimary(): ParseResult {
		const token = this.next();

		if (token.kind === 'number') {
			return { ok: true, node: { kind: 'number', value: token.value, at: token.at } };
		}
		if (token.kind === 'string') {
			return { ok: true, node: { kind: 'string', value: token.value, at: token.at } };
		}
		if (token.kind === 'name') {
			if (this.atCall()) {
				return this.parseCall(token.value, token.at);
			}
			// A bare TRUE or FALSE is the value itself; the braced form is always a column, so a table with such a column still works.
			if (token.braced !== true) {
				const literal = BOOLEANS[token.value.toUpperCase()];
				if (literal !== undefined) {
					return {
						ok: true,
						node: { kind: 'boolean', value: literal, at: token.at },
					};
				}
			}
			return { ok: true, node: { kind: 'field', name: token.value, at: token.at } };
		}
		if (token.kind === 'op' && token.value === '(') {
			const inner = this.parseExpression(0);
			if (!inner.ok) {
				return inner;
			}
			const close = this.next();
			if (close.kind !== 'op' || close.value !== ')') {
				return {
					ok: false,
					error: { code: 'unclosed-paren', at: token.at },
				};
			}
			return inner;
		}

		return {
			ok: false,
			error: { code: 'unexpected-token', at: token.at },
		};
	}

	private parseCall(name: string, at: number): ParseResult {
		this.next();
		const args: FormulaNode[] = [];
		const first = this.peek();
		if (first.kind === 'op' && first.value === ')') {
			this.next();
			return { ok: true, node: { kind: 'call', name, args, at } };
		}
		for (;;) {
			const arg = this.parseExpression(0);
			if (!arg.ok) {
				return arg;
			}
			args.push(arg.node);
			const token = this.next();
			if (token.kind === 'op' && token.value === ',') {
				continue;
			}
			if (token.kind === 'op' && token.value === ')') {
				return { ok: true, node: { kind: 'call', name, args, at } };
			}
			return {
				ok: false,
				error: { code: 'bad-arguments', at: token.at },
			};
		}
	}
}

export function parseFormula(source: string): { ok: true; node: FormulaNode } | { ok: false; error: FormulaError } {
	const trimmed = source.trim();
	// A leading `=` is how a spreadsheet shows a formula; it carries no meaning.
	const body = trimmed.startsWith('=') ? trimmed.slice(1).trim() : trimmed;
	const lexed = tokenize(body);
	if (!lexed.ok) {
		return lexed;
	}
	return new Parser(lexed.tokens).parse();
}

export function fieldsUsed(node: FormulaNode, into = new Set<string>()): Set<string> {
	if (node.kind === 'field') {
		into.add(node.name);
	} else if (node.kind === 'call') {
		for (const arg of node.args) {
			fieldsUsed(arg, into);
		}
	} else if (node.kind === 'unary') {
		fieldsUsed(node.operand, into);
	} else if (node.kind === 'binary') {
		fieldsUsed(node.left, into);
		fieldsUsed(node.right, into);
	}
	return into;
}
