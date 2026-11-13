import { describe, expect, it } from 'vitest';
import { computeFormula, forgetParsedFormulas } from '../src/model/formula';
import { createEmptyDoc } from '../src/io/schema';
import { addRecord, setCellValue } from '../src/model/records';
import type { Field, LayerDoc } from '../src/types';

function board(fields: Field[]): { doc: LayerDoc; recordId: string } {
	const doc = createEmptyDoc('Board');
	doc.fields = fields;
	const record = addRecord(doc);
	return { doc, recordId: record.id };
}

function formulaField(id: string, formula: string): Field {
	return { id, name: id, type: 'formula', formula };
}

function value(doc: LayerDoc, fieldId: string): string {
	const field = doc.fields.find((candidate) => candidate.id === fieldId);
	const record = doc.records[0];
	if (!field || !record) {
		return '??';
	}
	const result = computeFormula(doc, record, field);
	return result.ok ? result.text : `#${result.error.code}`;
}

describe('computeFormula', () => {
	it('evaluates arithmetic with precedence', () => {
		const { doc } = board([formulaField('f', '1 + 2 * 3')]);
		expect(value(doc, 'f')).toBe('7');
	});

	it('honours parentheses', () => {
		const { doc } = board([formulaField('f', '(1 + 2) * 3')]);
		expect(value(doc, 'f')).toBe('9');
	});

	it('reads another column by name', () => {
		const { doc, recordId } = board([
			{ id: 'f_price', name: '单价', type: 'number' },
			{ id: 'n', name: 'n', type: 'number' },
			formulaField('f', '{单价} * {n}'),
		]);
		const record = doc.records.find((r) => r.id === recordId);
		record!.cells.f_price = 12.5;
		record!.cells.n = 4;
		expect(value(doc, 'f')).toBe('50');
	});

	it('joins text when + meets a string', () => {
		const { doc, recordId } = board([
			{ id: 'f_title', name: '标题', type: 'text' },
			formulaField('f', '{标题} + " 已发布"'),
		]);
		doc.records[0]!.cells.f_title = '方案';
		expect(doc.records[0]?.id).toBe(recordId);
		expect(value(doc, 'f')).toBe('方案 已发布');
	});

	it('computes the built-in functions', () => {
		const { doc } = board([
			formulaField('a', 'SUM(1, 2, 3)'),
			formulaField('b', 'AVERAGE(2, 4)'),
			formulaField('c', 'MIN(5, 2, 9)'),
			formulaField('d', 'MAX(5, 2, 9)'),
			formulaField('e', 'ROUND(1.234, 2)'),
			formulaField('g', 'ABS(-7)'),
			formulaField('h', 'CONCAT("a", 1)'),
			formulaField('i', 'LEN("abcd")'),
			formulaField('j', 'IF(1 > 0, "yes", "no")'),
			formulaField('k', 'COALESCE("", "fallback")'),
		]);
		expect(value(doc, 'a')).toBe('6');
		expect(value(doc, 'b')).toBe('3');
		expect(value(doc, 'c')).toBe('2');
		expect(value(doc, 'd')).toBe('9');
		expect(value(doc, 'e')).toBe('1.23');
		expect(value(doc, 'g')).toBe('7');
		expect(value(doc, 'h')).toBe('a1');
		expect(value(doc, 'i')).toBe('4');
		expect(value(doc, 'j')).toBe('yes');
		expect(value(doc, 'k')).toBe('fallback');
	});

	it('reports dividing by zero instead of yielding Infinity', () => {
		const { doc } = board([formulaField('f', '1 / 0')]);
		expect(value(doc, 'f')).toBe('#divide-by-zero');
	});

	it('takes a single = as equality, the way a spreadsheet writes it', () => {
		const { doc } = board([
			formulaField('a', '1 = 1'),
			formulaField('b', '1 = 2'),
			formulaField('c', '1 != 2'),
			formulaField('d', '1 <= 1'),
			formulaField('e', '2 >= 1'),
		]);
		expect(value(doc, 'a')).toBe('TRUE');
		expect(value(doc, 'b')).toBe('FALSE');
		expect(value(doc, 'c')).toBe('TRUE');
		expect(value(doc, 'd')).toBe('TRUE');
		expect(value(doc, 'e')).toBe('TRUE');
	});

	it('still reads the two-character forms correctly', () => {
		const { doc } = board([
			formulaField('a', '1 == 1'),
			formulaField('b', '1 == 2'),
		]);
		expect(value(doc, 'a')).toBe('TRUE');
		expect(value(doc, 'b')).toBe('FALSE');
	});

	it('compares a column against a text value', () => {
		const { doc } = board([
			{ id: 'f_state', name: 'state', type: 'select' },
			formulaField('f', '{state} = "done"'),
		]);
		doc.records[0]!.cells.f_state = 'done';
		expect(value(doc, 'f')).toBe('TRUE');
	});

	it('answers the logical functions', () => {
		const { doc } = board([
			formulaField('a', 'AND(TRUE, 1)'),
			formulaField('b', 'AND(TRUE, 0)'),
			formulaField('c', 'OR(FALSE, 1)'),
			formulaField('d', 'OR(FALSE, 0)'),
			formulaField('e', 'NOT(1)'),
			formulaField('f', 'NOT(0)'),
		]);
		expect(value(doc, 'a')).toBe('TRUE');
		expect(value(doc, 'b')).toBe('FALSE');
		expect(value(doc, 'c')).toBe('TRUE');
		expect(value(doc, 'd')).toBe('FALSE');
		expect(value(doc, 'e')).toBe('FALSE');
		expect(value(doc, 'f')).toBe('TRUE');
	});

	it('reads text as true unless it is empty or says otherwise', () => {
		const { doc } = board([
			formulaField('a', 'AND("x")'),
			formulaField('b', 'AND("")'),
			formulaField('c', 'AND("no")'),
			formulaField('d', 'AND("0")'),
		]);
		expect(value(doc, 'a')).toBe('TRUE');
		expect(value(doc, 'b')).toBe('FALSE');
		expect(value(doc, 'c')).toBe('FALSE');
		expect(value(doc, 'd')).toBe('FALSE');
	});

	it('answers blankness and counts what is filled', () => {
		const { doc } = board([
			formulaField('a', 'ISBLANK("")'),
			formulaField('b', 'ISBLANK("x")'),
			formulaField('c', 'COUNT(1, "", 2, BLANK())'),
			formulaField('d', 'BLANK()'),
		]);
		expect(value(doc, 'a')).toBe('TRUE');
		expect(value(doc, 'b')).toBe('FALSE');
		expect(value(doc, 'c')).toBe('2');
		expect(value(doc, 'd')).toBe('');
	});

	it('refuses the wrong number of arguments', () => {
		const { doc } = board([
			formulaField('a', 'NOT()'),
			formulaField('b', 'NOT(1, 2)'),
			formulaField('c', 'BLANK(1)'),
		]);
		expect(value(doc, 'a')).toBe('#bad-arity');
		expect(value(doc, 'b')).toBe('#bad-arity');
		expect(value(doc, 'c')).toBe('#bad-arity');
	});

	it('reports an unknown field', () => {
		const { doc } = board([formulaField('f', '{nope} + 1')]);
		expect(value(doc, 'f')).toBe('#unknown-field');
	});

	it('reports an unknown function', () => {
		const { doc } = board([formulaField('f', 'NOPE(1)')]);
		expect(value(doc, 'f')).toBe('#unknown-function');
	});

	it('reports a syntax error', () => {
		const { doc } = board([formulaField('f', '1 +')]);
		expect(value(doc, 'f')).toBe('#unexpected-token');
	});

	it('reports an empty formula', () => {
		const { doc } = board([formulaField('f', '   ')]);
		expect(value(doc, 'f')).toBe('#empty');
	});

	it('reads a relation column as the text the grid shows', () => {
		const { doc, recordId } = board([
			{ id: 'f_p', name: '项目', type: 'relation', linkFieldId: 'f_x' },
			formulaField('f', '{项目}'),
		]);
		doc.records[0]!.cells.f_p = [];
		expect(doc.records[0]?.id).toBe(recordId);
		expect(value(doc, 'f')).toBe('');
	});
});

describe('the kind of value a formula reports', () => {
	function kindOf(formula: string): string {
		const { doc } = board([formulaField('f', formula)]);
		const record = doc.records[0]!;
		const result = computeFormula(doc, record, doc.fields[0]!);
		return result.ok ? result.kind : `error:${result.error.code}`;
	}

	it('calls arithmetic a number, so a total can line up', () => {
		expect(kindOf('1 + 2')).toBe('number');
		expect(kindOf('ROUND(1.5)')).toBe('number');
		expect(kindOf('SUM(1, 2)')).toBe('number');
		expect(kindOf('COUNT(1, "")')).toBe('number');
		expect(kindOf('LEN("ab")')).toBe('number');
	});

	it('calls a condition a boolean, so it can be drawn as a box', () => {
		expect(kindOf('1 > 0')).toBe('boolean');
		expect(kindOf('AND(TRUE)')).toBe('boolean');
		expect(kindOf('ISBLANK("")')).toBe('boolean');
		expect(kindOf('NOT(0)')).toBe('boolean');
	});

	it('calls text text', () => {
		expect(kindOf('"hello"')).toBe('text');
		expect(kindOf('CONCAT("a", "b")')).toBe('text');
		expect(kindOf('TEXT(1)')).toBe('text');
	});

	it('calls a joined number-and-text a text', () => {
		const { doc } = board([
			{ id: 'f_n', name: 'n', type: 'number' },
			formulaField('f', '{n} + " items"'),
		]);
		doc.records[0]!.cells.f_n = 3;
		const result = computeFormula(doc, doc.records[0]!, doc.fields[1]!);
		expect(result.ok && result.kind).toBe('text');
		expect(result.ok && result.text).toBe('3 items');
	});

	it('reports the kind of what it actually computed, not of the formula', () => {
		const { doc } = board([
			{ id: 'f_done', name: 'done', type: 'checkbox' },
			formulaField('f', 'IF({done}, 1, "pending")'),
		]);
		const record = doc.records[0]!;
		record.cells.f_done = true;
		const yes = computeFormula(doc, record, doc.fields[1]!);
		expect(yes.ok && yes.kind).toBe('number');

		record.cells.f_done = false;
		const no = computeFormula(doc, record, doc.fields[1]!);
		expect(no.ok && no.kind).toBe('text');
	});

	it('says nothing about a kind when it could not compute', () => {
		const { doc } = board([formulaField('f', '1 / 0')]);
		const result = computeFormula(doc, doc.records[0]!, doc.fields[0]!);
		expect(result.ok).toBe(false);
	});
});

describe('formulas that refer to each other', () => {
	it('lets one formula read another', () => {
		const { doc } = board([
			{ id: 'f_n', name: 'n', type: 'number' },
			formulaField('f_double', '{n} * 2'),
		]);
		// Rename so the second can read the first by name.
		doc.fields[1]!.name = 'double';
		doc.fields.push(formulaField('f_twice', '{double} * 2'));
		doc.records[0]!.cells.f_n = 5;
		expect(value(doc, 'f_double')).toBe('10');
		expect(value(doc, 'f_twice')).toBe('20');
	});

	it('reports a cycle instead of recursing forever', () => {
		const { doc } = board([]);
		doc.fields = [
			{ id: 'f_a', name: 'a', type: 'formula', formula: '{b} + 1' },
			{ id: 'f_b', name: 'b', type: 'formula', formula: '{a} + 1' },
		];
		const record = addRecord(doc);
		const field = doc.fields[0]!;
		const result = computeFormula(doc, record, field);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('cycle');
		}
	});

	it('reports a formula that reads itself', () => {
		const { doc } = board(
			[ { id: 'f_self', name: 'me', type: 'formula', formula: '{me}' } ],
		);
		const record = doc.records[0]!;
		const result = computeFormula(doc, record, doc.fields[0]!);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.code).toBe('cycle');
		}
	});
});

describe('parse caching', () => {
	it('still computes correctly after clearing the cache', () => {
		const { doc } = board([formulaField('f', '2 + 2')]);
		expect(value(doc, 'f')).toBe('4');
		forgetParsedFormulas();
		expect(value(doc, 'f')).toBe('4');
	});
});

describe('a branch that is not taken', () => {
	it('cannot fail the formula', () => {
		const { doc } = board([
			formulaField('a', 'IF(FALSE, 1/0, "safe")'),
			formulaField('b', 'IF(TRUE, "safe", 1/0)'),
			formulaField('c', 'IF(FALSE, {missing}, "safe")'),
		]);

		expect(value(doc, 'a')).toBe('safe');
		expect(value(doc, 'b')).toBe('safe');
		expect(value(doc, 'c')).toBe('safe');
	});

	it('is the one IF reads when the condition says so', () => {
		const { doc } = board([formulaField('a', 'IF(TRUE, 1/0, "safe")')]);

		expect(value(doc, 'a')).toBe('#divide-by-zero');
	});

	it('stops AND at the first false and OR at the first true', () => {
		const { doc } = board([
			formulaField('a', 'AND(FALSE, 1/0)'),
			formulaField('b', 'OR(TRUE, 1/0)'),
			formulaField('c', 'AND(TRUE, 1/0)'),
		]);

		expect(value(doc, 'a')).toBe('FALSE');
		expect(value(doc, 'b')).toBe('TRUE');
		expect(value(doc, 'c')).toBe('#divide-by-zero');
	});

	it('is not read past the first value COALESCE finds', () => {
		const { doc } = board([
			formulaField('a', 'COALESCE("a", {missing})'),
			formulaField('b', 'COALESCE("", {missing})'),
		]);

		expect(value(doc, 'a')).toBe('a');
		expect(value(doc, 'b')).toBe('#unknown-field');
	});

	it('is still read by the functions that need every value', () => {
		const { doc } = board([formulaField('a', 'TEXT(1/0)')]);

		expect(value(doc, 'a')).toBe('#divide-by-zero');
	});
});

describe('a percentage', () => {
	it('is a proportion, so multiplying by it is the arithmetic the type is for', () => {
		const rate: Field = { id: 'f_rate', name: 'rate', type: 'number', numberFormat: 'percent' };
		const { doc, recordId } = board([rate, formulaField('a', '{rate} * 200')]);
		setCellValue(doc, recordId, rate, 0.15);

		expect(value(doc, 'a')).toBe('30');
	});

	it('reads the sign in a text cell as the same proportion', () => {
		const label: Field = { id: 'f_label', name: 'label', type: 'text' };
		const { doc, recordId } = board([label, formulaField('b', 'SUM({label})')]);
		setCellValue(doc, recordId, label, '50%');

		expect(value(doc, 'b')).toBe('0.5');
	});
});
