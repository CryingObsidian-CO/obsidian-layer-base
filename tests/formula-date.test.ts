import { describe, expect, it } from 'vitest';
import { computeFormula } from '../src/model/formula';
import { createEmptyDoc } from '../src/io/schema';
import { addRecord } from '../src/model/records';
import type { Field, LayerDoc } from '../src/types';

/** A fixed moment, so "today" is the same answer every run. */
const NOW = new Date(2026, 9, 18, 14, 30);

function board(fields: Field[]): LayerDoc {
	const doc = createEmptyDoc('Board');
	doc.fields = fields;
	addRecord(doc);
	return doc;
}

function formulaField(id: string, formula: string): Field {
	return {id, name: id, type: 'formula', formula};
}

/** What one formula column computed for the single row, as text or `#code`. */
function value(doc: LayerDoc, id: string, now: Date = NOW): string {
	const field = doc.fields.find((candidate) => candidate.id === id);
	if (!field) {
		throw new Error(`no field ${id}`);
	}
	const result = computeFormula(doc, doc.records[0]!, field, 0, new Set(), now);
	return result.ok ? result.text : `#${result.error.code}`;
}

describe('dates in formulas', () => {
	it('knows what today is, from the clock it is given', () => {
		const doc = board([formulaField('f', 'TODAY()')]);
		expect(value(doc, 'f')).toBe('2026-10-18');
	});

	it('knows this minute', () => {
		const doc = board([formulaField('f', 'NOW()')]);
		expect(value(doc, 'f')).toBe('2026-10-18T14:30');
	});

	it('reads the parts of a date column', () => {
		const doc = board([
			{id: 'f_due', name: 'due', type: 'date'},
			formulaField('a', 'YEAR({due})'),
			formulaField('b', 'MONTH({due})'),
			formulaField('c', 'DAY({due})'),
		]);
		doc.records[0]!.cells.f_due = '2026-03-07';
		expect(value(doc, 'a')).toBe('2026');
		expect(value(doc, 'b')).toBe('3');
		expect(value(doc, 'c')).toBe('7');
	});

	it('reads the date part of a date-time', () => {
		const doc = board([
			{id: 'f_at', name: 'at', type: 'datetime'},
			formulaField('a', 'YEAR({at})'),
			formulaField('b', 'DAY({at})'),
		]);
		doc.records[0]!.cells.f_at = '2026-12-31T23:05';
		expect(value(doc, 'a')).toBe('2026');
		expect(value(doc, 'b')).toBe('31');
	});

	it('counts the days between two dates', () => {
		const doc = board([
			{id: 'f_from', name: 'from', type: 'date'},
			{id: 'f_to', name: 'to', type: 'date'},
			formulaField('f', 'DATEDIFF({from}, {to})'),
		]);
		doc.records[0]!.cells.f_from = '2026-10-01';
		doc.records[0]!.cells.f_to = '2026-10-18';
		expect(value(doc, 'f')).toBe('17');
	});

	it('counts backwards as a negative number', () => {
		const doc = board([
			{id: 'f_from', name: 'from', type: 'date'},
			{id: 'f_to', name: 'to', type: 'date'},
			formulaField('f', 'DATEDIFF({from}, {to})'),
		]);
		doc.records[0]!.cells.f_from = '2026-10-18';
		doc.records[0]!.cells.f_to = '2026-10-01';
		expect(value(doc, 'f')).toBe('-17');
	});

	it('answers how long is left until a due date', () => {
		const doc = board([
			{id: 'f_due', name: 'due', type: 'date'},
			formulaField('f', 'DATEDIFF(TODAY(), {due})'),
		]);
		doc.records[0]!.cells.f_due = '2026-10-25';
		expect(value(doc, 'f')).toBe('7');
	});

	it('moves a date by whole days, across months and years', () => {
		const doc = board([
			{id: 'f_d', name: 'd', type: 'date'},
			formulaField('a', 'DATEADD({d}, 14)'),
			formulaField('b', 'DATEADD({d}, -18)'),
		]);
		doc.records[0]!.cells.f_d = '2026-12-25';
		expect(value(doc, 'a')).toBe('2027-01-08');
		expect(value(doc, 'b')).toBe('2026-12-07');
	});

	it('keeps the time of a date-time when moving it', () => {
		const doc = board([
			{id: 'f_at', name: 'at', type: 'datetime'},
			formulaField('f', 'DATEADD({at}, 1)'),
		]);
		doc.records[0]!.cells.f_at = '2026-10-18T09:15';
		expect(value(doc, 'f')).toBe('2026-10-19T09:15');
	});

	it('handles a leap day rather than shifting it', () => {
		const doc = board([
			{id: 'f_d', name: 'd', type: 'date'},
			formulaField('f', 'DATEADD({d}, 1)'),
		]);
		doc.records[0]!.cells.f_d = '2028-02-28';
		expect(value(doc, 'f')).toBe('2028-02-29');
	});

	it('still compares dates as text, which is why ISO is stored', () => {
		const doc = board([
			{id: 'f_due', name: 'due', type: 'date'},
			formulaField('f', '{due} < "2026-10-20"'),
		]);
		doc.records[0]!.cells.f_due = '2026-10-18';
		expect(value(doc, 'f')).toBe('TRUE');
	});

	it('answers whether something is overdue, the reason text compares', () => {
		// The point of letting text compare at all: a date column is text, and
		// "is this past its due date" is the question people actually ask.
		const doc = board([
			{id: 'f_due', name: 'due', type: 'date'},
			formulaField('f', 'IF({due} < TODAY(), "overdue", "on time")'),
		]);
		doc.records[0]!.cells.f_due = '2026-10-01';
		expect(value(doc, 'f')).toBe('overdue');
		doc.records[0]!.cells.f_due = '2026-12-01';
		expect(value(doc, 'f')).toBe('on time');
	});

	it('refuses text that is not a date, naming it', () => {
		const doc = board([
			{id: 'f_t', name: 't', type: 'text'},
			formulaField('a', 'YEAR({t})'),
			formulaField('b', 'DATEDIFF({t}, TODAY())'),
		]);
		doc.records[0]!.cells.f_t = 'soon';
		expect(value(doc, 'a')).toBe('#not-a-date');
		expect(value(doc, 'b')).toBe('#not-a-date');
	});

	it('refuses a shift that is not a whole number of days', () => {
		const doc = board([
			{id: 'f_d', name: 'd', type: 'date'},
			formulaField('f', 'DATEADD({d}, 1.5)'),
		]);
		doc.records[0]!.cells.f_d = '2026-10-18';
		expect(value(doc, 'f')).toBe('#not-a-number');
	});

	it('reports the date as a date, not as a number', () => {
		// The cell presents it as text because a date is stored as text; what
		// matters is that it is not mistaken for something to add up.
		const doc = board([formulaField('f', 'TODAY()')]);
		const result = computeFormula(doc, doc.records[0]!, doc.fields[0]!, 0, new Set(), NOW);
		expect(result.ok && result.kind).toBe('text');
	});

	it('gives the same answer twice for the same clock', () => {
		// Nothing in here reads the system clock, so a render cannot drift.
		const doc = board([formulaField('f', 'TODAY()')]);
		expect(value(doc, 'f')).toBe(value(doc, 'f'));
	});
});
