import { describe, expect, it } from 'vitest';
import type { Field, LayerDoc, LayerRecord } from '../src/types';
import { CellReader, type CellReaderHost } from '../src/model/cell-reader';

function doc(name: string, fields: Field[], records: LayerRecord[] = []): LayerDoc {
	return { version: 1, name, fields, records, views: [] };
}

function record(id: string, cells: Record<string, string | number | boolean | string[]>): LayerRecord {
	return { id, created: '', cells };
}

function hostFor(
	tables: Record<string, LayerDoc>,
	notes: Record<string, string> = {},
): CellReaderHost {
	return {
		table: (field, from, direction) => {
			const path = direction === 'back' ? field.backPath : field.linkPath;
			return path ? (tables[path] ?? null) : from;
		},
		noteProperty: (path, key) => notes[`${path}\u0000${key}`] ?? '',
		formulaError: (error) => ({ text: `#${error.code}`, hint: error.code }),
	};
}

const title: Field = { id: 'f_title', name: 'Title', type: 'text', primary: true };
const amount: Field = { id: 'f_amount', name: 'Amount', type: 'number' };
const link: Field = {
	id: 'f_link',
	name: 'Items',
	type: 'relation',
	linkPath: 'items.layer',
	linkFieldId: 'f_name',
};

describe('computed cell readings', () => {
	it('computes a formula from stored numbers', () => {
		const a: Field = { id: 'f_a', name: 'A', type: 'number' };
		const b: Field = { id: 'f_b', name: 'B', type: 'number' };
		const sum: Field = {
			id: 'f_sum',
			name: 'Sum',
			type: 'formula',
			formula: '{A} + {B}',
		};
		const table = doc('Numbers', [a, b, sum], [record('r1', { f_a: 2, f_b: 3 })]);
		const reader = new CellReader(hostFor({}));
		expect(reader.formulaReading(table, sum, 'r1').text).toBe('5');
	});

	it('sums a rollup and lets a formula add its number', () => {
		const target = doc(
			'Items',
			[title, amount],
			[record('i1', { f_title: 'One', f_amount: 2 }), record('i2', { f_title: 'Two', f_amount: 4 })],
		);
		const total: Field = {
			id: 'f_total',
			name: 'Total',
			type: 'rollup',
			rollupSourceFieldId: 'f_link',
			rollupFieldId: 'f_amount',
			rollupAggregate: 'sum',
		};
		const plusOne: Field = {
			id: 'f_plus',
			name: 'Plus one',
			type: 'formula',
			formula: '{Total} + 1',
		};
		const table = doc('Orders', [title, link, total, plusOne], [record('o1', { f_link: ['i1', 'i2'] })]);
		const reader = new CellReader(hostFor({ 'items.layer': target }));
		expect(reader.rollupReading(table, total, 'o1').text).toBe('6');
		expect(reader.formulaReading(table, plusOne, 'o1').text).toBe('7');
	});

	it('reads a lookup from the linked table', () => {
		const target = doc(
			'Items',
			[title],
			[record('i1', { f_title: 'One' }), record('i2', { f_title: 'Two' })],
		);
		const lookup: Field = {
			id: 'f_lookup',
			name: 'Names',
			type: 'lookup',
			lookupSourceFieldId: 'f_link',
			lookupFieldId: 'f_title',
		};
		const table = doc('Orders', [title, link, lookup], [record('o1', { f_link: ['i1', 'i2'] })]);
		const reader = new CellReader(hostFor({ 'items.layer': target }));
		expect(reader.lookupReading(table, lookup, 'o1').text).toBe('One, Two');
	});

	it('reads a backlink title from the table pointing back', () => {
		const childTitle: Field = { id: 'f_name', name: 'Name', type: 'text', primary: true };
		const parentLink: Field = {
			id: 'f_parent',
			name: 'Parent',
			type: 'relation',
			linkPath: 'parents.layer',
			linkFieldId: 'f_title',
		};
		const children = doc('Children', [childTitle, parentLink], [record('c1', { f_name: 'Child', f_parent: ['p1'] })]);
		const back: Field = {
			id: 'f_children',
			name: 'Children',
			type: 'relationBack',
			backPath: 'children.layer',
			backFieldId: 'f_parent',
			backTitleFieldId: 'f_name',
		};
		const table = doc('Parents', [title, back], [record('p1', { f_title: 'Parent' })]);
		const reader = new CellReader(hostFor({ 'children.layer': children }));
		expect(reader.backReading(table, back, 'p1').text).toBe('Child');
	});

	it('reads a note property through the host', () => {
		const note: Field = { id: 'f_note', name: 'Note', type: 'note' };
		const prop: Field = {
			id: 'f_prop',
			name: 'Status',
			type: 'noteProp',
			noteFieldId: 'f_note',
			frontmatterKey: 'status',
		};
		const table = doc('Notes', [title, note, prop], [record('r1', { f_title: 'One', f_note: 'Notes/One' })]);
		const reader = new CellReader(
			hostFor({}, { 'Notes/One\u0000status': 'done' }),
		);
		expect(reader.notePropReading(table, prop, 'r1').text).toBe('done');
	});

	it('marks an unreadable note property with a hint instead of a silent empty', () => {
		const note: Field = { id: 'f_note', name: 'Note', type: 'note' };
		const prop: Field = {
			id: 'f_prop',
			name: 'Owner',
			type: 'noteProp',
			noteFieldId: 'f_note',
			frontmatterKey: 'owner',
		};
		const table = doc('Notes', [title, note, prop], [record('r1', { f_title: 'One', f_note: 'Notes/One' })]);
		const reader = new CellReader({
			...hostFor({}),
			noteProperty: () => null,
		});
		const reading = reader.notePropReading(table, prop, 'r1');
		expect(reading.text).toBe('');
		expect(reading.hint).toContain('nested');
	});
});
