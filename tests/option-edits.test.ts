import { describe, expect, it } from 'vitest';
import {
	appendOption,
	findOptionByName,
	normaliseOptionColor,
	removeOption,
	renameOption,
	reorderOption,
	setOptionColor,
} from '../src/model/select-options';
import type { Field, SelectOption } from '../src/types';

/*
 * Editing a choice column after it exists, which the app has always been able to do
 * from its column panel. These are the five moves a reader makes there — add, remove,
 * rename, recolour, reorder — and every one of them leaves the ids alone unless it is
 * creating one: a cell stores the id, so a rename that replaced it would orphan every
 * row that had chosen that option, while a reorder only moves ids about in the list.
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

/*
 * The order of the list is the field's order: the board draws its columns in it and
 * a choice column sorts by it, so a reader who cannot reorder the list is stuck with
 * whatever order the names happened to be typed in.
 */
describe('reordering the options', () => {
	const names = (
		options: readonly SelectOption[] | null | undefined,
	): string[] => (options ?? []).map((option) => option.name);

	const idsOf = (field: Field): (string | undefined)[] =>
		(field.options ?? []).map((option) => option.id);

	it('moves one option and keeps every id', () => {
		const field = status();
		const before = idsOf(field);

		const next = reorderOption(field.options ?? [], before[1] ?? '', 0);

		expect(names(next)).toEqual(['Green', 'Red']);
		expect((next ?? []).map((option) => option.id)).toEqual([
			before[1],
			before[0],
		]);
		// The field itself is left alone: the caller decides when to store it.
		expect(names(field.options)).toEqual(['Red', 'Green']);
	});

	it('takes the index the option ends up at, counted in the moved list', () => {
		const field = status();

		const next = reorderOption(field.options ?? [], idsOf(field)[0] ?? '', 1);

		expect(names(next)).toEqual(['Green', 'Red']);
	});

	it('reports nothing to move instead of handing back a copy', () => {
		const field = status();

		expect(
			reorderOption(field.options ?? [], idsOf(field)[0] ?? '', 0),
		).toBeNull();
		expect(reorderOption(field.options ?? [], 'o_missing', 1)).toBeNull();
		expect(reorderOption([], 'o_missing', 0)).toBeNull();
	});

	it('keeps a target that ran off either end inside the list', () => {
		const field = status();

		expect(
			names(reorderOption(field.options ?? [], idsOf(field)[0] ?? '', 99)),
		).toEqual(['Green', 'Red']);
		expect(
			names(reorderOption(field.options ?? [], idsOf(field)[1] ?? '', -5)),
		).toEqual(['Green', 'Red']);
	});
});
