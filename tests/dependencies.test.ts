import { describe, expect, it } from 'vitest';
import { createEmptyDoc } from '../src/io/schema';
import { affectedByEdit } from '../src/model/dependencies';
import type { Field, LayerDoc } from '../src/types';

function board(fields: Field[]): LayerDoc {
	const doc = createEmptyDoc('Board');
	doc.fields = fields;
	return doc;
}

function ids(fields: Field[]): string[] {
	return fields.map((field) => field.id);
}

describe('what an edit makes stale', () => {
	it('finds the lookup that gathers through a link column', () => {
		const doc = board([
			{ id: 'f_link', name: 'link', type: 'relation' },
			{
				id: 'f_look',
				name: 'look',
				type: 'lookup',
				lookupSourceFieldId: 'f_link',
				lookupFieldId: 'f_name',
			},
		]);
		expect(ids(affectedByEdit(doc, doc.fields[0]!))).toEqual(['f_look']);
	});

	it('follows a chain: a formula reading a rollup that gathers through it', () => {
		const doc = board([
			{ id: 'f_link', name: 'link', type: 'relation' },
			{
				id: 'f_sum',
				name: 'sum',
				type: 'rollup',
				rollupSourceFieldId: 'f_link',
				rollupFieldId: 'f_n',
			},
			{ id: 'f_calc', name: 'calc', type: 'formula', formula: '{sum} + 1' },
		]);
		expect(ids(affectedByEdit(doc, doc.fields[0]!))).toEqual(['f_sum', 'f_calc']);
	});

	it('finds the note property that reads through a note column', () => {
		const doc = board([
			{ id: 'f_note', name: 'note', type: 'note' },
			{
				id: 'f_prop',
				name: 'prop',
				type: 'noteProp',
				noteFieldId: 'f_note',
				frontmatterKey: 'status',
			},
		]);
		expect(ids(affectedByEdit(doc, doc.fields[0]!))).toEqual(['f_prop']);
	});

	it('finds a formula that names the column', () => {
		const doc = board([
			{ id: 'f_t', name: 'title', type: 'text', primary: true },
			{ id: 'f_calc', name: 'calc', type: 'formula', formula: '{title} + "!"' },
		]);
		expect(ids(affectedByEdit(doc, doc.fields[0]!))).toEqual(['f_calc']);
	});

	it('leaves a second column of the same name alone, since nothing reads it', () => {
		const doc = board([
			{ id: 'f_t', name: 'title', type: 'text', primary: true },
			{ id: 'f_dup', name: 'title', type: 'text' },
			{ id: 'f_calc', name: 'calc', type: 'formula', formula: '{title} + "!"' },
		]);
		expect(ids(affectedByEdit(doc, doc.fields[0]!))).toEqual(['f_calc']);
		expect(ids(affectedByEdit(doc, doc.fields[1]!))).toEqual([]);
	});

	it('includes an auto number counted within this column', () => {
		const doc = board([
			{ id: 'f_grp', name: 'group', type: 'select', options: [] },
			{ id: 'f_no', name: 'no', type: 'autoNumber', numberGroupFieldId: 'f_grp' },
		]);
		expect(ids(affectedByEdit(doc, doc.fields[0]!))).toEqual(['f_no']);
	});

	it('ignores a formula that cannot be parsed', () => {
		const doc = board([
			{ id: 'f_t', name: 'title', type: 'text', primary: true },
			{ id: 'f_calc', name: 'calc', type: 'formula', formula: '{title' },
		]);
		expect(affectedByEdit(doc, doc.fields[0]!)).toEqual([]);
	});

	it('finds nothing for a column nothing reads', () => {
		const doc = board([
			{ id: 'f_a', name: 'a', type: 'text', primary: true },
			{ id: 'f_b', name: 'b', type: 'text' },
		]);
		expect(affectedByEdit(doc, doc.fields[0]!)).toEqual([]);
	});
});
