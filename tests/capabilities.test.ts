import { describe, expect, it } from 'vitest';
import { CAPABILITIES, acceptsValue, capabilityOf, readsFromView } from '../src/model/capabilities';
import {
	FIELD_TYPES,
	canBeRequired,
	emptyValueFor,
	isDerived,
	isReadOnly,
	usesOptions,
} from '../src/model/fields';
import type { Field, FieldType } from '../src/types';

function typesWhere(check: (type: FieldType) => boolean): FieldType[] {
	return FIELD_TYPES.filter(check);
}

describe('the capability table', () => {
	it('answers for every field type', () => {
		expect(Object.keys(CAPABILITIES).sort()).toEqual([...FIELD_TYPES].sort());
	});

	it('names the types whose value is computed rather than stored', () => {
		expect(typesWhere(isDerived)).toEqual([
			'lookup',
			'relationBack',
			'autoNumber',
			'rollup',
			'formula',
			'noteProp',
		]);
	});

	it('leaves a note property editable, unlike every other computed type', () => {
		expect(typesWhere(isReadOnly)).toEqual([
			'lookup',
			'relationBack',
			'autoNumber',
			'rollup',
			'formula',
		]);
	});

	it('offers the required flag only where the reader fills the cell in', () => {
		expect(typesWhere(canBeRequired)).toEqual([
			'text',
			'longtext',
			'number',
			'date',
			'datetime',
			'relation',
			'select',
			'multiSelect',
			'checkbox',
			'note',
		]);
	});

	it('refuses to name a row with a value that is not text', () => {
		expect(typesWhere((type) => !capabilityOf(type).namesARow)).toEqual([
			'relation',
			'relationBack',
			'checkbox',
		]);
	});

	it('has an option list for the two types that pick from one', () => {
		expect(typesWhere(usesOptions)).toEqual(['select', 'multiSelect']);
	});

	// A relation is stored, yet reads from the view: the document cannot say what the cell shows.
	it('names the types whose text only the view can read', () => {
		expect(typesWhere(readsFromView)).toEqual([
			'relation',
			'lookup',
			'relationBack',
			'autoNumber',
			'rollup',
			'formula',
			'noteProp',
		]);
	});

	it('sends every type whose value is computed to the view as well', () => {
		for (const type of FIELD_TYPES) {
			if (isDerived(type)) {
				expect(readsFromView(type), type).toBe(true);
			}
		}
		expect(isDerived('relation')).toBe(false);
		expect(readsFromView('relation')).toBe(true);
	});
});

describe('the shape a value must have', () => {
	it('takes text where the type stores text, and nothing else', () => {
		expect(acceptsValue('text', 'abc')).toBe(true);
		expect(acceptsValue('date', '2026-01-31')).toBe(true);
		expect(acceptsValue('text', 42)).toBe(false);
		expect(acceptsValue('select', 42)).toBe(false);
	});

	it('takes a number, and the empty string that clears it', () => {
		expect(acceptsValue('number', 42)).toBe(true);
		expect(acceptsValue('number', '')).toBe(true);
		expect(acceptsValue('number', 0)).toBe(true);
		expect(acceptsValue('number', '42')).toBe(false);
	});

	it('takes a list for the two multi-value types', () => {
		expect(acceptsValue('relation', ['r_1'])).toBe(true);
		expect(acceptsValue('multiSelect', [])).toBe(true);
		expect(acceptsValue('relation', 'r_1')).toBe(false);
	});

	it('takes a real boolean for a checkbox, not the word', () => {
		expect(acceptsValue('checkbox', true)).toBe(true);
		expect(acceptsValue('checkbox', false)).toBe(true);
		expect(acceptsValue('checkbox', 'true')).toBe(false);
	});

	it('takes nothing at all for a computed column', () => {
		for (const type of [
			'lookup',
			'relationBack',
			'autoNumber',
			'rollup',
			'formula',
			'noteProp',
		] as const) {
			expect(acceptsValue(type, 'anything')).toBe(false);
			expect(acceptsValue(type, '')).toBe(false);
		}
	});
});

describe('what the footer and a rollup may report', () => {
	it('offers the counts on every type', () => {
		for (const type of FIELD_TYPES) {
			expect(capabilityOf(type).summaries.slice(0, 4)).toEqual([
				'none',
				'filled',
				'empty',
				'unique',
			]);
		}
	});

	it('offers arithmetic only where adding up means something', () => {
		expect(capabilityOf('number').summaries).toContain('sum');
		expect(capabilityOf('autoNumber').summaries).toContain('sum');
		expect(capabilityOf('date').summaries).not.toContain('sum');
		expect(capabilityOf('text').summaries).not.toContain('sum');
	});

	it('summarises a date as a span', () => {
		expect(capabilityOf('date').summaries).toContain('range');
		expect(capabilityOf('number').summaries).not.toContain('range');
	});

	it('always lets a rollup count, whatever the column holds', () => {
		for (const type of FIELD_TYPES) {
			expect(capabilityOf(type).aggregates).toContain('count');
			expect(capabilityOf(type).aggregates).toContain('countAll');
		}
	});

	it('offers a filter operator for every type', () => {
		for (const type of FIELD_TYPES) {
			expect(capabilityOf(type).filters.length).toBeGreaterThan(0);
		}
	});
});

describe('the helpers', () => {
	it('are answered by the table, so no second opinion can appear', () => {
		for (const type of FIELD_TYPES) {
			const field: Field = { id: 'f_a', name: 'A', type };
			expect(usesOptions(type)).toBe(CAPABILITIES[type].options);
			expect(isDerived(type)).toBe(CAPABILITIES[type].derived);
			expect(isReadOnly(type)).toBe(CAPABILITIES[type].readOnly);
			expect(canBeRequired(type)).toBe(CAPABILITIES[type].required);
			expect(readsFromView(type)).toBe(CAPABILITIES[type].readsFromView);
			expect(emptyValueFor(field)).toEqual(CAPABILITIES[type].empty());
		}
	});

	it('hands back a fresh list for a cleared multi-value cell', () => {
		const field: Field = { id: 'f_a', name: 'A', type: 'multiSelect' };
		const first = emptyValueFor(field) as unknown[];
		const second = emptyValueFor(field) as unknown[];
		expect(first).toEqual([]);
		expect(first).not.toBe(second);
	});
});
