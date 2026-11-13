import { describe, expect, it } from 'vitest';
import {
	OPTION_PALETTE,
	appendOption,
	filterOptions,
	findOptionByName,
	nextOptionColor,
	normaliseOptionName,
	optionColorHex,
	optionCssColor,
} from '../src/model/select-options';
import type { Field, SelectOption } from '../src/types';

const HEXES: Record<string, string> = {
	blue: '#086ddd',
	green: '#08b94e',
	orange: '#ec7500',
	purple: '#7852ee',
	red: '#e93147',
	cyan: '#00bfbc',
	yellow: '#e0ac00',
	pink: '#d53984',
};

const OPTIONS: SelectOption[] = [
	{ id: 'o_1', name: 'To do', color: 'default' },
	{ id: 'o_2', name: 'In progress', color: 'orange' },
	{ id: 'o_3', name: 'Done', color: 'green' },
];

function selectField(over: Partial<Field> = {}): Field {
	return {
		id: 'f_status',
		name: 'Status',
		type: 'select',
		options: OPTIONS.map((option) => ({ ...option })),
		...over,
	};
}

describe('OPTION_PALETTE', () => {
	it('lists the eight colours new options cycle through', () => {
		expect(OPTION_PALETTE).toEqual([
			'blue',
			'green',
			'orange',
			'purple',
			'red',
			'cyan',
			'yellow',
			'pink',
		]);
	});

	it('resolves every name it lists', () => {
		for (const name of OPTION_PALETTE) {
			expect(optionCssColor(name)).toBe(`var(--color-${name})`);
			expect(optionColorHex(name)).not.toBe('#888888');
		}
	});
});

describe('optionCssColor', () => {
	it('turns a palette name into its theme variable', () => {
		expect(optionCssColor('blue')).toBe('var(--color-blue)');
		expect(optionCssColor('orange')).toBe('var(--color-orange)');
		expect(optionCssColor('pink')).toBe('var(--color-pink)');
	});

	it('ignores the case and the padding of a palette name', () => {
		expect(optionCssColor('Blue')).toBe('var(--color-blue)');
		expect(optionCssColor('  green  ')).toBe('var(--color-green)');
	});

	it('hands back a var() reference as written', () => {
		expect(optionCssColor('var(--color-blue)')).toBe('var(--color-blue)');
		expect(optionCssColor('var(--color-mine)')).toBe('var(--color-mine)');
	});

	it('hands back a hex literal as written', () => {
		expect(optionCssColor('#abc')).toBe('#abc');
		expect(optionCssColor('#08b94e')).toBe('#08b94e');
		expect(optionCssColor('#AABBCC')).toBe('#AABBCC');
	});

	it('reports no colour for an unset option', () => {
		expect(optionCssColor(undefined)).toBeNull();
		expect(optionCssColor('')).toBeNull();
		expect(optionCssColor('   ')).toBeNull();
		expect(optionCssColor('default')).toBeNull();
	});

	it('reports no colour for anything it cannot resolve', () => {
		expect(optionCssColor('not-a-color')).toBeNull();
		expect(optionCssColor('blue-ish')).toBeNull();
		expect(optionCssColor('var(--foo)')).toBeNull();
		expect(optionCssColor('#12')).toBeNull();
		expect(optionCssColor('#1234')).toBeNull();
		expect(optionCssColor('#1234567')).toBeNull();
		expect(optionCssColor('#gggggg')).toBeNull();
	});
});

describe('optionColorHex', () => {
	it('gives every palette name its canonical hex', () => {
		for (const name of OPTION_PALETTE) {
			expect(optionColorHex(name)).toBe(HEXES[name]);
		}
	});

	it('resolves a theme variable for a palette name', () => {
		expect(optionColorHex('var(--color-red)')).toBe('#e93147');
		expect(optionColorHex('var(--color-cyan)')).toBe('#00bfbc');
	});

	it('expands a short hex literal', () => {
		expect(optionColorHex('#abc')).toBe('#aabbcc');
		expect(optionColorHex('#AbC')).toBe('#aabbcc');
	});

	it('lowercases a long hex literal', () => {
		expect(optionColorHex('#AABBCC')).toBe('#aabbcc');
		expect(optionColorHex('#08B94E')).toBe('#08b94e');
	});

	it('falls back to grey for anything it cannot resolve', () => {
		expect(optionColorHex(undefined)).toBe('#888888');
		expect(optionColorHex('')).toBe('#888888');
		expect(optionColorHex('default')).toBe('#888888');
		expect(optionColorHex('nonsense')).toBe('#888888');
		expect(optionColorHex('var(--color-mine)')).toBe('#888888');
		expect(optionColorHex('#12345')).toBe('#888888');
	});
});

describe('nextOptionColor', () => {
	it('starts at the head of the palette', () => {
		expect(nextOptionColor([])).toBe('blue');
		expect(nextOptionColor(undefined)).toBe('blue');
	});

	it('steps through the palette by how many options exist', () => {
		const options: SelectOption[] = [];
		const seen: string[] = [];
		for (let i = 0; i < OPTION_PALETTE.length; i++) {
			seen.push(nextOptionColor(options));
			options.push({ id: `o_${i}`, name: `Option ${i}`, color: 'blue' });
		}
		expect(seen).toEqual([...OPTION_PALETTE]);
	});

	it('wraps around when the palette runs out', () => {
		const full: SelectOption[] = OPTION_PALETTE.map((name, index) => ({
			id: `o_${index}`,
			name: name,
			color: name,
		}));
		expect(nextOptionColor(full)).toBe('blue');
		expect(nextOptionColor([...full, { id: 'o_x', name: 'Extra', color: 'blue' }])).toBe(
			'green',
		);
	});
});

describe('findOptionByName', () => {
	it('finds an option by its exact name', () => {
		expect(findOptionByName(selectField(), 'Done')?.id).toBe('o_3');
	});

	it('ignores case and surrounding whitespace', () => {
		expect(findOptionByName(selectField(), 'to do')?.id).toBe('o_1');
		expect(findOptionByName(selectField(), '  IN PROGRESS ')?.id).toBe('o_2');
	});

	it('returns nothing for a name no option has', () => {
		expect(findOptionByName(selectField(), 'Blocked')).toBeUndefined();
		expect(findOptionByName(selectField(), '')).toBeUndefined();
	});

	it('returns nothing when the field has no options', () => {
		expect(findOptionByName(selectField({ options: [] }), 'Done')).toBeUndefined();
		expect(
			findOptionByName(selectField({ options: undefined }), 'Done'),
		).toBeUndefined();
	});
});

describe('filterOptions', () => {
	it('keeps every option, in document order, for a blank query', () => {
		expect(filterOptions(OPTIONS, '').map((o) => o.id)).toEqual([
			'o_1',
			'o_2',
			'o_3',
		]);
		expect(filterOptions(OPTIONS, '   ').map((o) => o.id)).toEqual([
			'o_1',
			'o_2',
			'o_3',
		]);
	});

	it('matches part of a name, ignoring case', () => {
		expect(filterOptions(OPTIONS, 'do').map((o) => o.id)).toEqual(['o_1', 'o_3']);
		expect(filterOptions(OPTIONS, 'PROGRESS').map((o) => o.id)).toEqual(['o_2']);
	});

	it('returns nothing when no option matches', () => {
		expect(filterOptions(OPTIONS, 'blocked')).toEqual([]);
	});

	it('returns nothing when the field has no options', () => {
		expect(filterOptions(undefined, 'do')).toEqual([]);
		expect(filterOptions(undefined, '')).toEqual([]);
	});

	it('does not hand back the field\u2019s own array', () => {
		const options = OPTIONS.map((option) => ({ ...option }));
		expect(filterOptions(options, '')).not.toBe(options);
	});
});

describe('normaliseOptionName', () => {
	it('trims the typed name', () => {
		expect(normaliseOptionName('  Blocked ')).toBe('Blocked');
	});

	it('returns nothing to create for a blank query', () => {
		expect(normaliseOptionName('')).toBe('');
		expect(normaliseOptionName('   ')).toBe('');
	});
});

describe('appendOption', () => {
	it('creates the option list when the field has none', () => {
		const field = selectField({ options: undefined });
		appendOption(field, 'Blocked');
		expect(field.options?.length).toBe(1);
	});

	it('appends an option with an id and the next colour', () => {
		const field = selectField({ options: [] });
		const option = appendOption(field, 'Blocked');
		expect(option.id.startsWith('o_')).toBe(true);
		expect(option.name).toBe('Blocked');
		expect(option.color).toBe('blue');
		expect(field.options).toEqual([option]);
	});

	it('keeps stepping through the palette as options pile up', () => {
		const field = selectField({ options: undefined });
		const first = appendOption(field, 'First');
		const second = appendOption(field, 'Second');
		expect(first.color).toBe('blue');
		expect(second.color).toBe('green');
		expect(field.options?.map((o) => o.color)).toEqual(['blue', 'green']);
	});

	it('appends after the options already there', () => {
		const field = selectField();
		const option = appendOption(field, 'Blocked');
		expect(field.options?.length).toBe(4);
		expect(field.options?.[3]).toEqual(option);
	});
});
