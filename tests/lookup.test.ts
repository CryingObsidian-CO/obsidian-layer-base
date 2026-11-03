import { describe, expect, it } from 'vitest';
import {
	FIELD_TYPES,
	cellFromText,
	isDerived,
	isReadOnly,
	specFor,
} from '../src/model/fields';
import {
	createEmptyDoc,
	parseLayerDoc,
	serializeLayerDoc,
} from '../src/io/schema';
import { lookupChips } from '../src/model/relation';
import type { Field } from '../src/types';

function withLookup(): { fields: Field[]; lookup: Field } {
	const doc = createEmptyDoc('Board');
	const relation: Field = {
		id: 'f_rel',
		name: 'Related',
		type: 'relation',
		linkFieldId: doc.fields[0]?.id ?? '',
	};
	const lookup: Field = {
		id: 'f_look',
		name: 'Looked up',
		type: 'lookup',
		lookupSourceFieldId: relation.id,
		lookupFieldId: doc.fields[0]?.id ?? '',
	};
	doc.fields.push(relation, lookup);
	return { fields: doc.fields, lookup };
}

describe('the lookup type', () => {
	it('is offered as a type', () => {
		expect(FIELD_TYPES).toContain('lookup');
	});

	it('counts as derived and read-only, like a rollup', () => {
		expect(isDerived('lookup')).toBe(true);
		expect(isReadOnly('lookup')).toBe(true);
	});

	it('reads as nothing on its own: the value comes from the other table', () => {
		const { lookup } = withLookup();

		expect(specFor('lookup').toText(lookup, '')).toBe('');
		expect(cellFromText(lookup, 'anything').ok).toBe(false);
	});
});

describe('the chips a lookup draws', () => {
	it('reads a value through the column it came from', () => {
		const text: Field = { id: 'f_text', name: 'Text', type: 'text' };

		expect(lookupChips(text, ['基础设施', '世界'])).toEqual([
			'基础设施',
			'世界',
		]);
	});

	/*
	 * The case that was wrong: a gathered value is not a list of row ids, so it
	 * must go through the column's own formatter. Reading it as a link answered
	 * with nothing, which looked exactly like an empty column.
	 */
	it('shows a choice by its name, not by the id it stores', () => {
		const choice: Field = {
			id: 'f_choice',
			name: 'Status',
			type: 'select',
			options: [
				{ id: 'o_todo', name: 'To do', color: 'default' },
				{ id: 'o_done', name: 'Done', color: 'green' },
			],
		};

		expect(lookupChips(choice, ['o_done'])).toEqual(['Done']);
	});

	it('leaves blank values out, and keeps repeats and order', () => {
		const text: Field = { id: 'f_text', name: 'Text', type: 'text' };

		expect(lookupChips(text, ['b', '', '  ', 'a', 'b'])).toEqual([
			'b',
			'a',
			'b',
		]);
	});

	it('answers with nothing when there is nothing to show', () => {
		const text: Field = { id: 'f_text', name: 'Text', type: 'text' };

		expect(lookupChips(text, [])).toEqual([]);
	});

	/*
	 * A computed column stores nothing to format, so the caller has to say what the
	 * value reads as. Without that it contributed no chip at all, and the lookup
	 * showed a blank where the other table plainly held a value.
	 */
	it('takes the text the caller resolved for a computed column', () => {
		const formula: Field = { id: 'f_formula', name: 'Label', type: 'formula' };

		expect(
			lookupChips(formula, ['', ''], undefined, ['Ann-x', 'Bob-x']),
		).toEqual(['Ann-x', 'Bob-x']);
	});

	it('reads the stored value when the caller resolved nothing', () => {
		const amount: Field = { id: 'f_amount', name: 'Amount', type: 'number' };

		expect(lookupChips(amount, [10], undefined, [null])).toEqual(['10']);
	});

	it('reads a link column through the reader the caller supplies', () => {
		const link: Field = { id: 'f_link', name: 'Link', type: 'relation' };
		const names = (): readonly string[] => ['Ann', 'Bob'];

		// Without a reader it can only answer what it stores: the row ids.
		expect(lookupChips(link, ['[]'])).toEqual(['[]']);
		expect(
			lookupChips(link, [['r_1', 'r_2']], () => ['Ann', 'Bob']),
		).toEqual(['Ann', 'Bob']);
		expect(names()).toEqual(['Ann', 'Bob']);
	});
});

describe('a lookup survives a save and reload', () => {
	it('round-trips the two settings', () => {
		const doc = createEmptyDoc('Board');
		const relation: Field = {
			id: 'f_rel',
			name: 'Related',
			type: 'relation',
			linkFieldId: doc.fields[0]?.id ?? '',
		};
		const lookup: Field = {
			id: 'f_look',
			name: 'Looked up',
			type: 'lookup',
			lookupSourceFieldId: relation.id,
			lookupFieldId: doc.fields[1]?.id ?? '',
		};
		doc.fields.push(relation, lookup);

		const { doc: reloaded, warnings } = parseLayerDoc(serializeLayerDoc(doc));

		expect(warnings).toEqual([]);
		const parsed = reloaded.fields.find((field) => field.id === 'f_look');
		expect(parsed?.type).toBe('lookup');
		expect(parsed?.lookupSourceFieldId).toBe('f_rel');
		expect(parsed?.lookupFieldId).toBe(doc.fields[1]?.id);
	});

	it('drops settings it cannot read', () => {
		const doc = createEmptyDoc('Board');
		const raw = JSON.parse(serializeLayerDoc(doc)) as {
			fields: Record<string, unknown>[];
		};
		raw.fields.push({
			id: 'f_look',
			name: 'Looked up',
			type: 'lookup',
			lookupSourceFieldId: 42,
			lookupFieldId: { id: 'nope' },
		});

		const { doc: reloaded } = parseLayerDoc(JSON.stringify(raw));
		const parsed = reloaded.fields.find((field) => field.id === 'f_look');

		expect(parsed?.type).toBe('lookup');
		expect(parsed?.lookupSourceFieldId).toBeUndefined();
		expect(parsed?.lookupFieldId).toBeUndefined();
	});
});
