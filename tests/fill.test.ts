import { describe, expect, it } from 'vitest';
import { fillableFields } from '../src/views/grid/fill';
import type { Field, FieldType } from '../src/types';

const field = (type: FieldType): Field => ({ id: `f_${type}`, name: type, type });

const noteProp: Field = {
	id: 'f_np',
	name: 'Score',
	type: 'noteProp',
	noteFieldId: 'f_note',
	frontmatterKey: 'score',
};

describe('fillableFields', () => {
	it('leaves out the columns that store nothing', () => {
		const computed = (
			['formula', 'rollup', 'lookup', 'autoNumber', 'relationBack'] as FieldType[]
		).map(field);
		expect(fillableFields(computed)).toEqual([]);
	});

	it('leaves out a note property, whose cell carries the empty stored value', () => {
		// Editable yet derived: a fill would write '' and delete the key from every linked note.
		expect(fillableFields([noteProp])).toEqual([]);
	});

	it('keeps the columns that do store a value, in range order', () => {
		const storable: FieldType[] = [
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
		];
		expect(fillableFields(storable.map(field)).map((f) => f.type)).toEqual(
			storable,
		);
	});

	it('drops only the derived columns from a mixed range', () => {
		const mixed = [field('text'), noteProp, field('formula'), field('number')];
		expect(fillableFields(mixed).map((f) => f.type)).toEqual(['text', 'number']);
	});
});
