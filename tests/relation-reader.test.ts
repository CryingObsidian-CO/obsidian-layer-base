import { describe, expect, it } from 'vitest';
import { createEmptyDoc } from '../src/io/schema';
import { formatCell } from '../src/model/fields';
import { computeFormulaWithReader } from '../src/model/formula';
import {
	relationBackIndex,
	relationCandidates,
	relationText,
} from '../src/model/relation';
import type { Field, LayerDoc, LayerRecord } from '../src/types';

/*
 * The defect these pin: a relation showed nothing when the column it displays is
 * computed, and so did a lookup and a backlink title. The document reads a stored
 * cell and a computed column stores nothing at all, so the answer has to come from
 * whoever can see that table — the same answer this table's own cells get, asked
 * of the table they belong to.
 */

/** A table whose second column is computed from the first. */
function targetTable(): LayerDoc {
	const doc = createEmptyDoc('Target');
	doc.fields = [
		{ id: 'f_name', name: 'Name', type: 'text', primary: true },
		{ id: 'f_label', name: 'Label', type: 'formula', formula: '{Name} + "-x"' },
	];
	doc.records = [
		{ id: 'r_a', created: '2026-01-01T00:00:00.000Z', cells: { f_name: 'Ann' } },
		{ id: 'r_b', created: '2026-01-01T00:00:00.000Z', cells: { f_name: 'Bob' } },
	];
	return doc;
}

/** What the view does for a column its document cannot read on its own. */
function readerFor(doc: LayerDoc) {
	return (field: Field, record: LayerRecord): string => {
		if (field.type === 'formula') {
			const result = computeFormulaWithReader(doc, record, field, () => undefined);
			return result.ok ? result.text : '';
		}
		return formatCell(field, record.cells[field.id] ?? '');
	};
}

describe('a relation reading a computed column', () => {
	it('shows what the other table computes', () => {
		const doc = targetTable();

		expect(relationText(doc, 'f_label', ['r_a', 'r_b'], readerFor(doc))).toEqual({
			texts: ['Ann-x', 'Bob-x'],
			broken: 0,
		});
	});

	it('shows nothing when nobody can read it, as before', () => {
		expect(relationText(targetTable(), 'f_label', ['r_a', 'r_b'])).toEqual({
			texts: [],
			broken: 0,
		});
	});

	it('offers the computed values as choices', () => {
		const doc = targetTable();

		expect(
			relationCandidates(doc, 'f_label', readerFor(doc)).map((one) => one.text),
		).toEqual(['Ann-x', 'Bob-x']);
	});

	it('leaves a stored column to the document itself', () => {
		const doc = targetTable();

		expect(relationText(doc, 'f_name', ['r_a'], readerFor(doc)).texts).toEqual([
			'Ann',
		]);
	});
});

describe('a backlink reading a computed title', () => {
	it('names the pointing rows with what that table computes', () => {
		const source = createEmptyDoc('Source');
		source.fields = [
			{ id: 'f_link', name: 'Target', type: 'relation' },
			{ id: 'f_name', name: 'Name', type: 'text' },
			{ id: 'f_label', name: 'Label', type: 'formula', formula: '{Name} + "!"' },
		];
		source.records = [
			{
				id: 'r_1',
				created: '2026-01-01T00:00:00.000Z',
				cells: { f_link: ['r_t'], f_name: 'Ann' },
			},
		];

		const index = relationBackIndex(
			source,
			'f_link',
			'f_label',
			readerFor(source),
		);

		expect(index?.get('r_t')).toEqual(['Ann!']);
	});
});
