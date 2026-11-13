import { describe, expect, it } from 'vitest';
import {
	copyTextFor,
	FIELD_TYPES,
	cellFromText,
	cellToText,
	formatCell,
	isEmptyCell,
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
			'lookup',
			'relationBack',
			'autoNumber',
			'rollup',
			'formula',
			'select',
			'multiSelect',
			'checkbox',
			'note',
			'noteProp',
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

describe('what every type reads as', () => {
	function field(type: FieldType, extra: Partial<Field> = {}): Field {
		return { id: 'f', name: 'F', type, ...extra };
	}

	it('leaves text as it is', () => {
		expect(formatCell(field('text'), 'hi')).toBe('hi');
		expect(formatCell(field('longtext'), 'line\nline')).toBe('line\nline');
	});

	it('formats a number by its settings', () => {
		expect(formatCell(field('number'), 42)).toBe('42');
		expect(formatCell(field('number', { numberFormat: 'percent' }), 0.5)).toBe('50%');
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

	it('leaves a numbering cell to the view, which counts the rows', () => {
		expect(formatCell(field('autoNumber', { numberLength: 3 }), 7)).toBe('');
	});

	it('answers nothing for a type whose value lives elsewhere', () => {
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
describe('what copying a cell puts on the clipboard', () => {
	function field(type: FieldType, extra: Partial<Field> = {}): Field {
		return { id: 'f', name: 'F', type, ...extra };
	}

	it('takes the stored text for a stored column', () => {
		expect(copyTextFor(field('number'), 42)).toBe('42');
		expect(copyTextFor(field('text'), 'hi')).toBe('hi');
	});

	it('takes the supplied text for a column that stores nothing', () => {
		for (const type of [
			'formula',
			'rollup',
			'relationBack',
			'autoNumber',
		] as const) {
			expect(copyTextFor(field(type), '', 'from the view'), type).toBe(
				'from the view',
			);
		}
	});

	it('copies a relation as the names it shows, not the ids it stores', () => {
		expect(copyTextFor(field('relation'), ['r_3f9a', 'r_8c21'], 'Ann, Bob')).toBe(
			'Ann, Bob',
		);
		expect(copyTextFor(field('relation'), ['r_3f9a'])).toBe('');
	});

	it('answers nothing when a derived column has no supplied text', () => {
		expect(copyTextFor(field('formula'), '')).toBe('');
	});

	it('never puts a stored value in a derived cell on the clipboard', () => {
		expect(copyTextFor(field('rollup'), 'stale junk', '350')).toBe('350');
	});
});