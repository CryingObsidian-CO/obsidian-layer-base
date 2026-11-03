import { describe, expect, it } from 'vitest';
import {
	appendOption,
	findOptionByName,
	normaliseOptionColor,
	removeOption,
	renameOption,
	setOptionColor,
} from '../src/model/select-options';
import type { Field } from '../src/types';

/*
 * Editing a choice column after it exists, which the app has always been able to do
 * from its column panel. These are the four moves a reader makes there — add, remove,
 * rename, recolour — and each has to leave the ids alone unless it is creating one:
 * a cell stores the id, so a rename that replaced it would orphan every row that had
 * chosen that option.
 */
function status(): Field {
	const field: Field = { id: 'f_status', name: 'Status', type: 'select' };
	appendOption(field, 'Red');
	appendOption(field, 'Green');
	return field;
}

describe('editing a choice column', () => {
	it('gives a new option the next colour of the palette', () => {
		const field = status();

		expect(field.options?.[0]?.color).toBe('blue');
		expect(field.options?.[1]?.color).toBe('green');
	});

	it('renames an option without changing its id', () => {
		const field = status();
		const before = findOptionByName(field, 'Red')?.id;

		expect(renameOption(field, 'Red', 'Crimson')).toBe(true);
		expect(findOptionByName(field, 'Crimson')?.id).toBe(before);
		expect(findOptionByName(field, 'Red')).toBeUndefined();
	});

	it('refuses to rename an option it does not have', () => {
		expect(renameOption(status(), 'Blue', 'Navy')).toBe(false);
	});

	it('removes an option by name, ignoring case', () => {
		const field = status();

		expect(removeOption(field, 'red')).toBe(true);
		expect(field.options?.map((option) => option.name)).toEqual(['Green']);
		expect(removeOption(field, 'Red')).toBe(false);
	});

	it('stores a palette name and a hex value as written', () => {
		const field = status();

		expect(setOptionColor(field, 'Red', 'purple')).toBe(true);
		expect(findOptionByName(field, 'Red')?.color).toBe('purple');
		// What the app's colour picker hands over is a literal, not a palette name.
		expect(setOptionColor(field, 'Red', '#08b94e')).toBe(true);
		expect(findOptionByName(field, 'Red')?.color).toBe('#08b94e');
	});

	it('refuses a colour it cannot draw', () => {
		const field = status();

		expect(setOptionColor(field, 'Red', 'chartreuse')).toBe(false);
		expect(normaliseOptionColor('chartreuse')).toBeNull();
		expect(normaliseOptionColor('')).toBe('default');
	});
});
