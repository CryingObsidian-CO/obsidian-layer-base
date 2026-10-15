import { describe, expect, it } from 'vitest';
import {
	FIELD_TYPES,
	cellFromText,
	cellToText,
	formatCell,
	isEmptyCell,
	recordTitle,
	specFor,
} from '../src/model/fields';
import type { Field } from '../src/types';

const text = (over: Partial<Field> = {}): Field => ({
	id: 'f_a',
	name: 'Title',
	type: 'text',
	primary: true,
	...over,
});

const statusField: Field = {
	id: 'f_b',
	name: 'Status',
	type: 'select',
	options: [
		{ id: 'o_1', name: 'To do', color: 'default' },
		{ id: 'o_2', name: 'Done', color: 'green' },
	],
};

describe('field types', () => {
	it('supports exactly text and select', () => {
		// Deliberately short: a type is added with its spec, its editor and its
		// tests, never with a half-finished entry in this list.
		expect([...FIELD_TYPES]).toEqual(['text', 'select']);
	});

	it('gives every type an icon', () => {
		for (const type of FIELD_TYPES) {
			expect(specFor(type).icon).toBeTruthy();
			expect(specFor(type).type).toBe(type);
		}
	});
});

describe('isEmptyCell', () => {
	it('treats an empty string as nothing', () => {
		expect(isEmptyCell('')).toBe(true);
	});

	it('treats any content as something', () => {
		expect(isEmptyCell('x')).toBe(false);
		expect(isEmptyCell('0')).toBe(false);
		expect(isEmptyCell(' ')).toBe(false);
	});
});

describe('formatCell', () => {
	it('renders text as written', () => {
		expect(formatCell(text(), 'Write the plan')).toBe('Write the plan');
	});

	it('resolves a select id to its option name', () => {
		// The file stores option ids, so the display must go through the options.
		expect(formatCell(statusField, 'o_2')).toBe('Done');
	});

	it('keeps a dangling select id visible', () => {
		// Hiding it would make the column look merely empty, concealing the
		// broken reference.
		expect(formatCell(statusField, 'o_gone')).toBe('o_gone');
	});

	it('returns nothing for an empty value', () => {
		expect(formatCell(text(), '')).toBe('');
		expect(formatCell(statusField, '')).toBe('');
	});
});

describe('clipboard round trip', () => {
	it('copies a select as its option name, not its id', () => {
		// An id such as "o_2" is meaningless outside this file, so the clipboard
		// carries what a person actually sees.
		expect(cellToText(statusField, 'o_2')).toBe('Done');
	});

	it('pastes an option name back to its id', () => {
		expect(cellFromText(statusField, 'Done')).toEqual({
			ok: true,
			value: 'o_2',
		});
	});

	it('matches an option name without regard to case or padding', () => {
		expect(cellFromText(statusField, '  done  ')).toEqual({
			ok: true,
			value: 'o_2',
		});
	});

	it('refuses a name that matches no option', () => {
		// Refusing is distinct from clearing: the column keeps its value and the
		// user is told the paste did not fit.
		expect(cellFromText(statusField, 'Archived')).toEqual({ ok: false });
	});

	it('treats empty clipboard text as clearing the cell', () => {
		expect(cellFromText(statusField, '')).toEqual({ ok: true, value: '' });
		expect(cellFromText(text(), '')).toEqual({ ok: true, value: '' });
	});

	it('passes text through unchanged', () => {
		expect(cellToText(text(), 'anything')).toBe('anything');
		expect(cellFromText(text(), 'anything')).toEqual({
			ok: true,
			value: 'anything',
		});
	});
});

describe('recordTitle', () => {
	const doc = {
		version: 1,
		name: 'Board',
		fields: [text({ id: 'f_a', primary: true }), statusField],
		records: [],
		views: [],
	};

	it('uses the primary field', () => {
		expect(recordTitle(doc, { cells: { f_a: 'First', f_b: 'o_1' } })).toBe(
			'First',
		);
	});

	it('falls back to the first field when none is primary', () => {
		const noPrimary = { ...doc, fields: [text({ id: 'f_a' }), statusField] };
		expect(recordTitle(noPrimary, { cells: { f_a: 'Only' } })).toBe('Only');
	});

	it('returns an empty title for a missing value', () => {
		expect(recordTitle(doc, { cells: {} })).toBe('');
	});

	it('resolves a select primary through its options', () => {
		const selectPrimary = {
			...doc,
			fields: [statusField],
		};
		expect(recordTitle(selectPrimary, { cells: { f_b: 'o_2' } })).toBe('Done');
	});

	it('returns an empty title when the document has no fields', () => {
		expect(recordTitle({ fields: [] }, { cells: { f_a: 'x' } })).toBe('');
	});
});
