import { describe, expect, it } from 'vitest';
import { filterRecords } from '../src/model/filter';
import { sortRecords } from '../src/model/sort';
import type { CellTextResolver } from '../src/model/filter';
import type { Field, LayerRecord } from '../src/types';

/*
 * A `noteProp` cell holds nothing in the document: its text is read from another
 * file. These cases stand in for that file by answering through the resolver, which
 * is what lets such a column be filtered and sorted at all.
 */

const noteField: Field = { id: 'f_note', name: 'Note', type: 'note' };
const propField: Field = {
	id: 'f_prop',
	name: 'Status',
	type: 'noteProp',
	noteFieldId: 'f_note',
	frontmatterKey: 'status',
};
const fields = [noteField, propField];

function record(id: string, status: string): LayerRecord {
	return { id, created: '', cells: { f_note: `notes/${id}` } };
}

/** Stands in for the notes' frontmatter, keyed by row id. */
const statuses: Record<string, string> = { r1: 'done', r2: 'todo', r3: '' };

const resolve: CellTextResolver = (field, rec) =>
	field.type === 'noteProp' ? (statuses[rec.id] ?? '') : null;

const records = [record('r1', 'done'), record('r2', 'todo'), record('r3', '')];

describe('a cell text resolver', () => {
	it('lets a note property be filtered', () => {
		const kept = filterRecords(
			records,
			fields,
			{ conjunction: 'and', conditions: [{ fieldId: 'f_prop', operator: 'is', value: 'done' }] },
			undefined,
			resolve,
		);
		expect(kept.map((r) => r.id)).toEqual(['r1']);
	});

	it('reads an empty note property as empty', () => {
		const kept = filterRecords(
			records,
			fields,
			{ conjunction: 'and', conditions: [{ fieldId: 'f_prop', operator: 'isEmpty' }] },
			undefined,
			resolve,
		);
		expect(kept.map((r) => r.id)).toEqual(['r3']);
	});

	it('lets a note property be sorted', () => {
		const ordered = sortRecords(
			records,
			fields,
			[{ fieldId: 'f_prop', order: 'asc' }],
			resolve,
		);
		expect(ordered.map((r) => r.id)).toEqual(['r3', 'r1', 'r2']);
	});

	it('leaves every other type to the document', () => {
		const text: Field = { id: 'f_t', name: 'T', type: 'text' };
		const rows = [record('r1', 'done'), record('r2', 'todo')];
		const kept = filterRecords(
			rows,
			[text],
			{ conjunction: 'and', conditions: [{ fieldId: 'f_t', operator: 'is', value: 'x' }] },
			undefined,
			resolve,
		);
		// The resolver answers null for text, so the stored cells decide and none match.
		expect(kept).toHaveLength(0);
	});
});
