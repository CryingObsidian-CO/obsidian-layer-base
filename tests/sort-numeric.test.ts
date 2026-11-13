import { describe, expect, it } from 'vitest';
import { sortRecords } from '../src/model/sort';
import type { CellValue, Field, LayerRecord } from '../src/types';

// The collator gets decimals wrong: it compares digit runs, so `1.5` sorts before `1.25`.

function row(id: string, cells: Record<string, CellValue> = {}): LayerRecord {
	return { id, created: '', cells };
}

type Resolver = (field: Field, record: LayerRecord) => string | null;

function resolver(texts: Record<string, string>): Resolver {
	return (_field, record) => texts[record.id] ?? null;
}

function order(
	field: Field,
	records: readonly LayerRecord[],
	cellText?: Resolver,
	desc = false,
): string[] {
	return sortRecords(
		records,
		[field],
		[{ fieldId: field.id, order: desc ? 'desc' : 'asc' }],
		cellText,
	).map((one) => one.id);
}

const computed: Field = { id: 'f', name: 'Total', type: 'rollup' };
const text: Field = { id: 'f', name: 'Note', type: 'text' };

describe('ordering by a computed number', () => {
	const rows = [row('big'), row('small'), row('negative')];
	const texts = resolver({ big: '1.5', small: '1.25', negative: '-2' });

	it('compares the number, not the digits', () => {
		expect(order(computed, rows, texts)).toEqual(['negative', 'small', 'big']);
	});

	it('reverses the same order descending', () => {
		expect(order(computed, rows, texts, true)).toEqual([
			'big',
			'small',
			'negative',
		]);
	});
});

describe('ordering by a numbering column', () => {
	it('compares the padded number, not the padding', () => {
		const rows = [row('ten'), row('nine')];
		const texts = resolver({ ten: '10', nine: '09' });
		const numbering: Field = { id: 'f', name: 'No', type: 'autoNumber' };

		expect(order(numbering, rows, texts)).toEqual(['nine', 'ten']);
	});
});

describe('ordering a text column', () => {
	it('compares numbers held as text by value', () => {
		const rows = [row('ten', { f: '10' }), row('nine', { f: '9' })];

		expect(order(text, rows)).toEqual(['nine', 'ten']);
	});

	it('leaves text that is not a number to the collator', () => {
		const rows = [row('ten', { f: 'item 10' }), row('nine', { f: 'item 9' })];

		expect(order(text, rows)).toEqual(['nine', 'ten']);
	});

	it('does not read a phone number with leading spaces as anything else', () => {
		const rows = [row('b', { f: ' 2' }), row('a', { f: '1' })];

		expect(order(text, rows)).toEqual(['a', 'b']);
	});
});

describe('ordering with an empty cell', () => {
	const rows = [row('has', { f: 'x' }), row('none')];

	it('puts nothing first ascending', () => {
		expect(order(text, rows)).toEqual(['none', 'has']);
	});

	it('puts nothing last descending', () => {
		expect(order(text, rows, undefined, true)).toEqual(['has', 'none']);
	});
});
