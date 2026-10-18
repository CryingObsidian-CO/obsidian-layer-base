import type { FormulaError, FormulaValue } from './lexer';
import {
	daysBetween,
	nowIso,
	partOf,
	shiftDays,
	todayIso,
} from './dates';
import type { FormulaNode } from './parser';

/** What a formula needs from the row it sits in. */
export interface FormulaContext {
	/** The value of another column, by field name. */
	field(name: string): FormulaValue | undefined;
	/** Whether a field with this name exists. */
	hasField(name: string): boolean;
	/**
	 * What "now" is, for the functions that ask. Passed in rather than read from
	 * the system clock inside the engine, so a test can say what day it is and get
	 * the same answer twice.
	 */
	now: Date;
}

export type EvalResult =
	| { ok: true; value: FormulaValue }
	| { ok: false; error: FormulaError };

function fail(code: string, detail?: string, at?: number): EvalResult {
	return { ok: false, error: { code, detail, at } };
}

/** How a value reads in text: numbers without trailing noise, booleans as words. */
export function toText(value: FormulaValue): string {
	if (typeof value === 'number') {
		return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
	}
	if (typeof value === 'boolean') {
		return value ? 'TRUE' : 'FALSE';
	}
	return value;
}

/** The number a value stands for, or null when it does not stand for one. */
function toNumber(value: FormulaValue): number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null;
	}
	if (typeof value === 'boolean') {
		return value ? 1 : 0;
	}
	const trimmed = value.trim();
	if (trimmed === '') {
		return 0;
	}
	const parsed = Number(trimmed.replace(/%$/, ''));
	return Number.isFinite(parsed) ? parsed : null;
}

/** What a value means as a yes or no, shared so a forced checkbox follows it too. */
export function toBoolean(value: FormulaValue): boolean {
	if (typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'number') {
		return value !== 0;
	}
	const lowered = value.trim().toLowerCase();
	return !(lowered === '' || lowered === 'false' || lowered === '0' || lowered === 'no');
}

/** Arguments of a function, evaluated in order and reported as a list. */
function evalArgs(args: readonly FormulaNode[], context: FormulaContext): EvalResult[] {
	return args.map((arg) => evaluate(arg, context));
}

/**
 * The built-in functions.
 *
 * Kept small and total: each one either answers or reports why it could not, and
 * none of them can reach outside the row it was given.
 */
type Builtin = (
	values: FormulaValue[],
	at: number,
	now: Date,
) => EvalResult;

/** One part of a date, refusing a value that is not a date. */
function datePart(
	value: FormulaValue,
	which: 'year' | 'month' | 'day',
	at: number,
): EvalResult {
	const text = toText(value);
	const part = partOf(text, which);
	return part === null
		? fail('not-a-date', text, at)
		: { ok: true, value: part };
}

/**
 * What to name when a date was expected and something else was given.
 *
 * Two dates are checked for `DATEDIFF`, and only the offending one is worth
 * naming; when both look wrong the first is named, which is the one to look at.
 */
function notADate(...values: readonly string[]): string {
	return values.find((value) => partOf(value, 'year') === null) ?? values[0] ?? '';
}

const BUILTINS: Record<string, { min: number; max: number; run: Builtin }> = {
	SUM: {
		min: 1,
		max: Infinity,
		run: (values, at) => {
			let total = 0;
			for (const value of values) {
				const number = toNumber(value);
				if (number === null) {
					return fail('not-a-number', undefined, at);
				}
				total += number;
			}
			return { ok: true, value: total };
		},
	},
	AVERAGE: {
		min: 1,
		max: Infinity,
		run: (values, at) => {
			let total = 0;
			for (const value of values) {
				const number = toNumber(value);
				if (number === null) {
					return fail('not-a-number', undefined, at);
				}
				total += number;
			}
			return { ok: true, value: total / values.length };
		},
	},
	MIN: {
		min: 1,
		max: Infinity,
		run: (values, at) => {
			const numbers = values.map(toNumber);
			if (numbers.some((n) => n === null)) {
				return fail('not-a-number', undefined, at);
			}
			return { ok: true, value: Math.min(...(numbers as number[])) };
		},
	},
	MAX: {
		min: 1,
		max: Infinity,
		run: (values, at) => {
			const numbers = values.map(toNumber);
			if (numbers.some((n) => n === null)) {
				return fail('not-a-number', undefined, at);
			}
			return { ok: true, value: Math.max(...(numbers as number[])) };
		},
	},
	ROUND: {
		min: 1,
		max: 2,
		run: (values, at) => {
			const number = toNumber(values[0] as FormulaValue);
			if (number === null) {
				return fail('not-a-number', undefined, at);
			}
			const places = values.length > 1 ? toNumber(values[1] as FormulaValue) : 0;
			if (places === null || places < 0 || places > 10) {
				return fail('bad-digits', undefined, at);
			}
			const factor = 10 ** Math.trunc(places);
			return { ok: true, value: Math.round(number * factor) / factor };
		},
	},
	ABS: {
		min: 1,
		max: 1,
		run: (values, at) => {
			const number = toNumber(values[0] as FormulaValue);
			return number === null
				? fail('not-a-number', undefined, at)
				: { ok: true, value: Math.abs(number) };
		},
	},
	CONCAT: {
		min: 1,
		max: Infinity,
		run: (values) => ({ ok: true, value: values.map(toText).join('') }),
	},
	LEN: {
		min: 1,
		max: 1,
		run: (values) => ({ ok: true, value: toText(values[0] as FormulaValue).length }),
	},
	IF: {
		min: 2,
		max: 3,
		run: (values) => {
			const condition = toBoolean(values[0] as FormulaValue);
			if (condition) {
				return { ok: true, value: values[1] as FormulaValue };
			}
			return { ok: true, value: values.length > 2 ? (values[2] as FormulaValue) : '' };
		},
	},
	COALESCE: {
		min: 1,
		max: Infinity,
		run: (values) => {
			for (const value of values) {
				if (value !== '') {
					return { ok: true, value };
				}
			}
			return { ok: true, value: '' };
		},
	},
	TEXT: {
		min: 1,
		max: 1,
		run: (values) => ({ ok: true, value: toText(values[0] as FormulaValue) }),
	},
	AND: {
		min: 1,
		max: Infinity,
		run: (values) => ({ ok: true, value: values.every(toBoolean) }),
	},
	OR: {
		min: 1,
		max: Infinity,
		run: (values) => ({ ok: true, value: values.some(toBoolean) }),
	},
	NOT: {
		min: 1,
		max: 1,
		run: (values) => ({ ok: true, value: !toBoolean(values[0] as FormulaValue) }),
	},
	// Empty is about the text a value reads as, so an unticked box is not blank
	// and an empty cell is.
	ISBLANK: {
		min: 1,
		max: 1,
		run: (values) => ({
			ok: true,
			value: toText(values[0] as FormulaValue).trim() === '',
		}),
	},
	// The empty value itself, for writing `IF(x, y, BLANK())` explicitly.
	BLANK: {
		min: 0,
		max: 0,
		run: () => ({ ok: true, value: '' }),
	},
	// How many of the given values are filled. Without column references this is
	// what counting can honestly mean, and `COUNT({a}, {b})` still answers it.
	COUNT: {
		min: 1,
		max: Infinity,
		run: (values) => ({
			ok: true,
			value: values.filter((value) => toText(value).trim() !== '').length,
		}),
	},
	TODAY: {
		min: 0,
		max: 0,
		run: (_values, _at, now) => ({ ok: true, value: todayIso(now) }),
	},
	NOW: {
		min: 0,
		max: 0,
		run: (_values, _at, now) => ({ ok: true, value: nowIso(now) }),
	},
	// A date column holds text, so these read that text rather than a number. A
	// value that is not a date is refused instead of being guessed at.
	YEAR: {
		min: 1,
		max: 1,
		run: (values, at) => datePart(values[0] as FormulaValue, 'year', at),
	},
	MONTH: {
		min: 1,
		max: 1,
		run: (values, at) => datePart(values[0] as FormulaValue, 'month', at),
	},
	DAY: {
		min: 1,
		max: 1,
		run: (values, at) => datePart(values[0] as FormulaValue, 'day', at),
	},
	// From the first date to the second, so a negative answer means "still ahead".
	DATEDIFF: {
		min: 2,
		max: 2,
		run: (values, at) => {
			const from = toText(values[0] as FormulaValue);
			const to = toText(values[1] as FormulaValue);
			const days = daysBetween(from, to);
			return days === null
				? fail('not-a-date', notADate(from, to), at)
				: { ok: true, value: days };
		},
	},
	DATEADD: {
		min: 2,
		max: 2,
		run: (values, at) => {
			const text = toText(values[0] as FormulaValue);
			const days = toNumber(values[1] as FormulaValue);
			if (days === null || !Number.isInteger(days)) {
				return fail('not-a-number', toText(values[1] as FormulaValue), at);
			}
			const shifted = shiftDays(text, days);
			return shifted === null
				? fail('not-a-date', text, at)
				: { ok: true, value: shifted };
		},
	},
};

/** The names a formula may call, for the editor to list. */
export const FORMULA_FUNCTIONS: readonly string[] = Object.keys(BUILTINS).sort();

/**
 * How the functions are grouped where they are offered, by what they are for.
 *
 * Declared next to the functions themselves rather than in the panel, so the two
 * can be checked against each other: every function must sit in exactly one
 * group, and a group must not name a function that does not exist.
 */
export const FORMULA_FUNCTION_GROUPS: readonly {
	/** The locale key naming the group. */
	labelKey: string;
	functions: readonly string[];
}[] = [
	{
		labelKey: 'formulaGroupNumber',
		functions: ['SUM', 'AVERAGE', 'MIN', 'MAX', 'ROUND', 'ABS', 'COUNT'],
	},
	{
		labelKey: 'formulaGroupText',
		functions: ['CONCAT', 'LEN', 'TEXT'],
	},
	{
		labelKey: 'formulaGroupLogic',
		functions: ['IF', 'AND', 'OR', 'NOT', 'ISBLANK', 'BLANK', 'COALESCE'],
	},
	{
		labelKey: 'formulaGroupDate',
		functions: ['TODAY', 'NOW', 'YEAR', 'MONTH', 'DAY', 'DATEDIFF', 'DATEADD'],
	},
];

/**
 * The symbols a formula is written with, grouped the way the functions are.
 *
 * Offered as buttons so the syntax does not have to be known in order to be used,
 * and each carries the key of a sentence saying what it does — a symbol on its own
 * tells a reader that it exists, not what it is for. `hintKey` is declared here
 * rather than looked up from the symbol so the check script can prove that every
 * one of them has wording in all three locales.
 */
export const FORMULA_SYMBOL_GROUPS: readonly {
	/** The locale key naming the group. */
	labelKey: string;
	symbols: readonly { symbol: string; hintKey: string }[];
}[] = [
	{
		labelKey: 'formulaGroupCompare',
		symbols: [
			{symbol: '=', hintKey: 'formulaSymEquals'},
			{symbol: '!=', hintKey: 'formulaSymNotEquals'},
			{symbol: '>', hintKey: 'formulaSymGreater'},
			{symbol: '<', hintKey: 'formulaSymLess'},
			{symbol: '>=', hintKey: 'formulaSymGreaterEqual'},
			{symbol: '<=', hintKey: 'formulaSymLessEqual'},
		],
	},
	{
		labelKey: 'formulaGroupCalculate',
		symbols: [
			{symbol: '+', hintKey: 'formulaSymPlus'},
			{symbol: '-', hintKey: 'formulaSymMinus'},
			{symbol: '*', hintKey: 'formulaSymTimes'},
			{symbol: '/', hintKey: 'formulaSymDivide'},
			{symbol: '%', hintKey: 'formulaSymModulo'},
		],
	},
	{
		labelKey: 'formulaGroupJoin',
		symbols: [
			{symbol: '(', hintKey: 'formulaSymOpen'},
			{symbol: ')', hintKey: 'formulaSymClose'},
			{symbol: ',', hintKey: 'formulaSymComma'},
			{symbol: '"', hintKey: 'formulaSymQuote'},
			{symbol: 'TRUE', hintKey: 'formulaSymTrue'},
			{symbol: 'FALSE', hintKey: 'formulaSymFalse'},
		],
	},
];

/** The total a formula is allowed to compute, used only as a guard. */
export function evaluate(node: FormulaNode, context: FormulaContext): EvalResult {
	switch (node.kind) {
		case 'number':
			return { ok: true, value: node.value };
		case 'string':
			return { ok: true, value: node.value };
		case 'boolean':
			return { ok: true, value: node.value };
		case 'field': {
			if (!context.hasField(node.name)) {
				return fail('unknown-field', node.name, node.at);
			}
			return { ok: true, value: context.field(node.name) ?? '' };
		}
		case 'unary': {
			const operand = evaluate(node.operand, context);
			if (!operand.ok) {
				return operand;
			}
			const number = toNumber(operand.value);
			if (number === null) {
				return fail('not-a-number', undefined, node.at);
			}
			return { ok: true, value: node.op === '-' ? -number : number };
		}
		case 'binary': {
			const left = evaluate(node.left, context);
			if (!left.ok) {
				return left;
			}
			const right = evaluate(node.right, context);
			if (!right.ok) {
				return right;
			}
			return applyBinary(node.op, left.value, right.value, node.at);
		}
		case 'call': {
			const builtin = BUILTINS[node.name.toUpperCase()];
			if (!builtin) {
				return fail('unknown-function', node.name, node.at);
			}
			if (node.args.length < builtin.min || node.args.length > builtin.max) {
				return fail(
					'bad-arity',
					`「${node.name}」 cannot take ${node.args.length} argument(s).`,
					node.at,
				);
			}
			const results = evalArgs(node.args, context);
			const failed = results.find((result) => !result.ok);
			if (failed) {
				return failed;
			}
			const values = results.map(
				(result) => (result as { ok: true; value: FormulaValue }).value,
			);
			return builtin.run(values, node.at, context.now);
		}
	}
}

function applyBinary(op: string, left: FormulaValue, right: FormulaValue, at: number): EvalResult {
	switch (op) {
		case '==':
		case '=':
			// = and == mean the same thing; the short form is what a spreadsheet
			// user reaches for.
			return { ok: true, value: compareEqual(left, right) };
		case '!=':
			return { ok: true, value: !compareEqual(left, right) };
		case '<':
		case '>':
		case '<=':
		case '>=': {
			const a = toNumber(left);
			const b = toNumber(right);
			if (a === null || b === null) {
				/*
				 * Two values that are not numbers compare as text, which is what
				 * makes `{due} < TODAY()` work at all: a date column holds ISO
				 * text, and ISO text sorts in date order.
				 */
				const x = toText(left);
				const y = toText(right);
				if (op === '<') {
					return { ok: true, value: x < y };
				}
				if (op === '>') {
					return { ok: true, value: x > y };
				}
				if (op === '<=') {
					return { ok: true, value: x <= y };
				}
				return { ok: true, value: x >= y };
			}
			if (op === '<') {
				return { ok: true, value: a < b };
			}
			if (op === '>') {
				return { ok: true, value: a > b };
			}
			if (op === '<=') {
				return { ok: true, value: a <= b };
			}
			return { ok: true, value: a >= b };
		}
		case '+': {
			// `+` joins text when either side is text, which is what a reader
			// expects from `{标题} + "-" + {编号}`.
			if (typeof left === 'string' || typeof right === 'string') {
				return { ok: true, value: toText(left) + toText(right) };
			}
			const a = toNumber(left);
			const b = toNumber(right);
			if (a === null || b === null) {
				return fail('not-a-number', undefined, at);
			}
			return { ok: true, value: a + b };
		}
		case '-':
		case '*':
		case '/':
		case '%': {
			const a = toNumber(left);
			const b = toNumber(right);
			if (a === null || b === null) {
				return fail('not-a-number', undefined, at);
			}
			if (op === '-') {
				return { ok: true, value: a - b };
			}
			if (op === '*') {
				return { ok: true, value: a * b };
			}
			if (b === 0) {
				return fail(
					op === '/' ? 'divide-by-zero' : 'modulo-by-zero',
					undefined,
					at,
				);
			}
			return { ok: true, value: op === '/' ? a / b : a % b };
		}
		default:
			return fail('unknown-operator', op, at);
	}
}

function compareEqual(left: FormulaValue, right: FormulaValue): boolean {
	if (typeof left === 'number' || typeof right === 'number') {
		const a = toNumber(left);
		const b = toNumber(right);
		return a !== null && b !== null && a === b;
	}
	return toText(left) === toText(right);
}
