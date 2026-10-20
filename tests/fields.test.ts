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
import type { Field, FieldType } from '../src/types';

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
	it('offers every type, in a stable order', () => {
		expect([...FIELD_TYPES]).toEqual([
			'text',
			'longtext',
			'number',
			'date',
			'datetime',
			'relation',
			'relationBack',
			'autoNumber',
			'rollup',
			'formula',
			'select',
			'multiSelect',
			'checkbox',
		]);
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
		expect(formatCell(statusField, 'o_2')).toBe('Done');
	});

	it('keeps a dangling select id visible', () => {
		expect(formatCell(statusField, 'o_gone')).toBe('o_gone');
	});

	it('returns nothing for an empty value', () => {
		expect(formatCell(text(), '')).toBe('');
		expect(formatCell(statusField, '')).toBe('');
	});
});

describe('clipboard round trip', () => {
	it('copies a select as its option name, not its id', () => {
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

describe('what every type reads as', () => {
	/*
	 * `formatCell` now looks its answer up in the same table the rest of the module
	 * uses, instead of a hand-written chain. These cases pin what each type shows,
	 * so the two cannot drift apart again without a test failing.
	 */
	function field(type: FieldType, extra: Partial<Field> = {}): Field {
		return { id: 'f', name: 'F', type, ...extra };
	}

	it('leaves text as it is', () => {
		expect(formatCell(field('text'), 'hi')).toBe('hi');
		expect(formatCell(field('longtext'), 'line\nline')).toBe('line\nline');
	});

	it('formats a number by its settings', () => {
		expect(formatCell(field('number'), 42)).toBe('42');
		expect(formatCell(field('number', { numberFormat: 'percent' }), 50)).toBe('50%');
	});

	it('shows a date and a date-time as they read', () => {
		expect(formatCell(field('date'), '2026-10-18')).toBe('2026-10-18');
		expect(formatCell(field('datetime'), '2026-10-18T09:05')).toBe('2026-10-18 09:05');
	});

	it('names the options a choice holds', () => {
		const options = [
			{ id: 'o1', name: 'Done', color: 'blue' },
			{ id: 'o2', name: 'Todo', color: 'red' },
		];
		expect(formatCell(field('select', { options }), 'o1')).toBe('Done');
		expect(formatCell(field('multiSelect', { options }), ['o1', 'o2'])).toBe(
			'Done, Todo',
		);
	});

	it('keeps a stale option id visible rather than blanking the cell', () => {
		expect(formatCell(field('select', { options: [] }), 'gone')).toBe('gone');
	});

	it('pads an auto number', () => {
		expect(formatCell(field('autoNumber', { numberLength: 3 }), 7)).toBe('007');
	});

	it('answers nothing for a type whose value lives elsewhere', () => {
		// These three are computed by the view, which is the only layer that can see
		// the other table or the row's formula.
		for (const type of ['relationBack', 'rollup', 'formula'] as const) {
			expect(formatCell(field(type), ''), type).toBe('');
		}
	});

	it('answers nothing for an empty value whatever the type', () => {
		expect(formatCell(field('number'), '')).toBe('');
		expect(formatCell(field('checkbox'), false)).toBe('');
		expect(formatCell(field('multiSelect', { options: [] }), [])).toBe('');
	});

	it('reads a ticked box as text', () => {
		expect(formatCell(field('checkbox'), true)).toBe('true');
	});
});