import { describe, expect, it } from 'vitest';
import { formatCell } from '../src/model/fields';
import { sortRecords } from '../src/model/sort';
import type { CellValue, Field, LayerRecord, SelectOption } from '../src/types';

// A choice column's order is its option order, not the names in the cells; the names below are deliberately not alphabetical.

function row(id: string, cells: Record<string, CellValue> = {}): LayerRecord {
	return { id, created: '', cells };
}

function order(
	field: Field,
	records: readonly LayerRecord[],
	desc = false,
): string[] {
	return sortRecords(records, [field], [
		{ fieldId: field.id, order: desc ? 'desc' : 'asc' },
	]).map((one) => one.id);
}

function option(id: string, name: string): SelectOption {
	return { id, name, color: 'blue' };
}

const status: Field = {
	id: 'f_status',
	name: 'Status',
	type: 'select',
	options: [
		option('o_later', 'Zulu'),
		option('o_soon', 'Alpha'),
		option('o_now', 'Mike'),
	],
};

describe('ordering a choice column by its options', () => {
	const rows = [
		row('later', { f_status: 'o_later' }),
		row('now', { f_status: 'o_now' }),
		row('soon', { f_status: 'o_soon' }),
	];

	it('follows the option order rather than the names in the cells', () => {
		expect(order(status, rows)).toEqual(['later', 'soon', 'now']);
	});

	it('reverses with the sort direction', () => {
		expect(order(status, rows, true)).toEqual(['now', 'soon', 'later']);
	});

	it('puts a cell with no choice first ascending and last descending', () => {
		const withEmpty = [...rows, row('empty')];

		expect(order(status, withEmpty)).toEqual([
			'empty',
			'later',
			'soon',
			'now',
		]);
		expect(order(status, withEmpty, true)).toEqual([
			'now',
			'soon',
			'later',
			'empty',
		]);
	});

	it('puts a choice whose option is gone after the ones that remain', () => {
		const stale = [...rows, row('stale', { f_status: 'o_deleted' })];

		expect(order(status, stale)).toEqual([
			'later',
			'soon',
			'now',
			'stale',
		]);
	});
});

describe('ordering a multiple-choice column', () => {
	const tags: Field = {
		id: 'f_tags',
		name: 'Tags',
		type: 'multiSelect',
		options: [
			option('o_zulu', 'Zulu'),
			option('o_alpha', 'Alpha'),
			option('o_mike', 'Mike'),
		],
	};

	it('shows what a cell holds in the option order, whatever order it was stored in', () => {
		expect(formatCell(tags, ['o_alpha', 'o_zulu'])).toBe('Zulu, Alpha');
	});

	it('compares the first option each cell holds', () => {
		const rows = [
			row('alpha', { f_tags: ['o_alpha'] }),
			row('zulu', { f_tags: ['o_zulu'] }),
		];

		expect(order(tags, rows)).toEqual(['zulu', 'alpha']);
	});

	it('puts the shorter selection before the one that extends it', () => {
		const rows = [
			row('both', { f_tags: ['o_zulu', 'o_mike'] }),
			row('one', { f_tags: ['o_zulu'] }),
		];

		expect(order(tags, rows)).toEqual(['one', 'both']);
	});

	it('orders the whole set of cells as a sequence of options', () => {
		const rows = [
			row('zulu', { f_tags: ['o_zulu'] }),
			row('both', { f_tags: ['o_zulu', 'o_mike'] }),
			row('alpha', { f_tags: ['o_alpha'] }),
			row('mike', { f_tags: ['o_mike'] }),
			row('empty'),
		];

		expect(order(tags, rows)).toEqual([
			'empty',
			'zulu',
			'both',
			'alpha',
			'mike',
		]);
		expect(order(tags, rows, true)).toEqual([
			'mike',
			'alpha',
			'both',
			'zulu',
			'empty',
		]);
	});
});
