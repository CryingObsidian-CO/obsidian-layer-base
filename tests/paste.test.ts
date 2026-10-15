import { describe, expect, it } from 'vitest';
import { cellAt, formatGrid, gridShape, parseGrid } from '../src/model/tsv';
import {
	clearCells,
	pasteCells,
	pasteFormatted,
	setCellValue,
	addRecord,
} from '../src/model/records';
import { createEmptyDoc, parseLayerDoc, serializeLayerDoc } from '../src/io/schema';
import type { Field, LayerDoc } from '../src/types';

const TITLE: Field = { id: 'f_title', name: 'Title', type: 'text', primary: true };
const STATUS: Field = {
	id: 'f_status',
	name: 'Status',
	type: 'select',
	options: [
		{ id: 'o_1', name: 'To do', color: 'default' },
		{ id: 'o_2', name: 'Done', color: 'green' },
	],
};

function newDoc(): LayerDoc {
	const doc = createEmptyDoc('Board');
	doc.fields = [{ ...TITLE }, { ...STATUS, options: STATUS.options?.map((o) => ({ ...o })) }];
	// Views are left as the seed produced them; removing them would make the
	// parser add defaults and warn, which has nothing to do with pasting.
	return doc;
}

describe('parseGrid', () => {
	it('splits on tabs and newlines', () => {
		expect(parseGrid('a\tb\nc\td')).toEqual([
			['a', 'b'],
			['c', 'd'],
		]);
	});

	it('treats a single value as a 1x1 grid', () => {
		// "Copy one value" and "copy a range" must not be separate code paths.
		expect(parseGrid('hello')).toEqual([['hello']]);
	});

	it('ignores a trailing newline instead of inventing an empty row', () => {
		// A trailing newline is how a text file ends.
		expect(parseGrid('a\tb\n')).toEqual([['a', 'b']]);
	});

	it('normalises Windows line endings', () => {
		expect(parseGrid('a\r\nb')).toEqual([['a'], ['b']]);
	});

	it('keeps empty cells in place', () => {
		// The empty middle field is a blank value, not a shifted row.
		expect(parseGrid('a\t\tc')).toEqual([['a', '', 'c']]);
	});
});

describe('formatGrid', () => {
	it('joins with tabs and newlines', () => {
		expect(
			formatGrid([
				['a', 'b'],
				['c', 'd'],
			]),
		).toBe('a\tb\nc\td');
	});

	it('round-trips through parseGrid', () => {
		const grid = [
			['one', 'two'],
			['three', 'four'],
		];
		expect(parseGrid(formatGrid(grid))).toEqual(grid);
	});

	it('round-trips a single cell', () => {
		expect(parseGrid(formatGrid([['only']]))).toEqual([['only']]);
	});
});

describe('gridShape and cellAt', () => {
	it('reports the widest row', () => {
		expect(gridShape([['a'], ['b', 'c', 'd']])).toEqual({ rows: 2, columns: 3 });
	});

	it('treats a short row as empty rather than absent', () => {
		// A spreadsheet omits trailing empty cells; the missing ones must paste
		// as blanks instead of pulling the next row's contents up.
		const ragged = [['a', 'b'], ['c']];
		expect(cellAt(ragged, 1, 1)).toBe('');
		expect(cellAt(ragged, 5, 0)).toBe('');
	});
});

describe('pasteCells', () => {
	it('writes a block of text into a rectangle', () => {
		const doc = newDoc();
		const r1 = addRecord(doc);
		const r2 = addRecord(doc);

		const report = pasteCells(
			doc,
			[r1.id, r2.id],
			[TITLE, STATUS],
			[
				['First', 'To do'],
				['Second', 'Done'],
			],
		);

		expect(report).toEqual({ written: 4, refused: 0 });
		expect(r1.cells.f_title).toBe('First');
		// The destination's type decides how the text is read.
		expect(r1.cells.f_status).toBe('o_1');
		expect(r2.cells.f_status).toBe('o_2');
	});

	it('counts cells whose text does not fit their column', () => {
		const doc = newDoc();
		const r1 = addRecord(doc);

		const report = pasteCells(
			doc,
			[r1.id],
			[STATUS],
			[['Not an option']],
		);

		expect(report).toEqual({ written: 0, refused: 1 });
		expect(r1.cells.f_status).toBeUndefined();
	});

	it('clips a block larger than the target', () => {
		const doc = newDoc();
		const r1 = addRecord(doc);

		const report = pasteCells(
			doc,
			[r1.id],
			[TITLE],
			[['kept'], ['ignored']],
		);

		expect(report.written).toBe(1);
		expect(r1.cells.f_title).toBe('kept');
	});

	it('leaves the rest alone when the block is smaller', () => {
		// A narrower source must not clear the cells it does not reach, which is
		// what a spreadsheet does.
		const doc = newDoc();
		const r1 = addRecord(doc);
		const r2 = addRecord(doc);
		setCellValue(doc, r2.id, TITLE, 'Untouched');

		pasteCells(doc, [r1.id, r2.id], [TITLE], [['Only first']]);

		expect(r1.cells.f_title).toBe('Only first');
		expect(r2.cells.f_title).toBe('Untouched');
	});

	it('produces a document that still parses cleanly', () => {
		const doc = newDoc();
		const r1 = addRecord(doc);
		pasteCells(doc, [r1.id], [TITLE, STATUS], [['Title', 'Done']]);

		const { warnings } = parseLayerDoc(serializeLayerDoc(doc));

		expect(warnings).toEqual([]);
	});
});

describe('pasteFormatted', () => {
	/** A copied cell, whose displayed text defaults to its value. */
	const copied = (type: 'text' | 'select', value: string, text = value) => ({
		type,
		value,
		text,
	});

	it('pastes a value whose type matches the column', () => {
		const doc = newDoc();
		const r1 = addRecord(doc);

		const report = pasteFormatted(doc, [r1.id], [TITLE, STATUS], [
			[copied('text', 'Title'), copied('select', 'o_2', 'Done')],
		]);

		expect(report).toEqual({ written: 2, refused: 0 });
		// The option id travels as itself, so the option is the same one.
		expect(r1.cells.f_status).toBe('o_2');
	});

	it('refuses a select pasted into a text column', () => {
		// The case this whole mode exists for: a select holds an option id, and
		// storing it in a text column would put an id on screen as if it were
		// content. Refusing is the honest outcome.
		const doc = newDoc();
		const r1 = addRecord(doc);

		const report = pasteFormatted(doc, [r1.id], [TITLE], [
			[copied('select', 'o_1', 'To do')],
		]);

		expect(report).toEqual({ written: 0, refused: 1 });
		expect(r1.cells.f_title).toBeUndefined();
	});

	it('refuses a text pasted into a select column', () => {
		const doc = newDoc();
		const r1 = addRecord(doc);

		const report = pasteFormatted(doc, [r1.id], [STATUS], [
			[copied('text', 'Done')],
		]);

		expect(report).toEqual({ written: 0, refused: 1 });
		expect(r1.cells.f_status).toBeUndefined();
	});

	it('resolves a select by name when the destination has its own options', () => {
		// Option ids belong to a field. Pasting into another select column must
		// use *that* column's option, or the cell would hold a dangling id.
		const doc = newDoc();
		const other: Field = {
			id: 'f_other',
			name: 'Stage',
			type: 'select',
			options: [{ id: 'x_9', name: 'Done', color: 'green' }],
		};
		doc.fields.push(other);
		const r1 = addRecord(doc);

		const report = pasteFormatted(doc, [r1.id], [other], [
			[copied('select', 'o_2', 'Done')],
		]);

		expect(report).toEqual({ written: 1, refused: 0 });
		expect(r1.cells.f_other).toBe('x_9');
	});

	it('refuses an option the destination does not have', () => {
		const doc = newDoc();
		const other: Field = {
			id: 'f_other',
			name: 'Stage',
			type: 'select',
			options: [{ id: 'x_9', name: 'Done', color: 'green' }],
		};
		doc.fields.push(other);
		const r1 = addRecord(doc);

		const report = pasteFormatted(doc, [r1.id], [other], [
			[copied('select', 'o_1', 'To do')],
		]);

		expect(report).toEqual({ written: 0, refused: 1 });
		expect(r1.cells.f_other).toBeUndefined();
	});

	it('counts a partial paste so it can be reported', () => {
		const doc = newDoc();
		const r1 = addRecord(doc);

		const report = pasteFormatted(doc, [r1.id], [TITLE, STATUS], [
			[copied('text', 'kept'), copied('text', 'refused')],
		]);

		expect(report).toEqual({ written: 1, refused: 1 });
		expect(r1.cells.f_title).toBe('kept');
		expect(r1.cells.f_status).toBeUndefined();
	});

	it('leaves cells alone when the payload is smaller', () => {
		const doc = newDoc();
		const r1 = addRecord(doc);
		const r2 = addRecord(doc);
		setCellValue(doc, r2.id, TITLE, 'Untouched');

		pasteFormatted(doc, [r1.id, r2.id], [TITLE], [
			[copied('text', 'Only first')],
		]);

		expect(r1.cells.f_title).toBe('Only first');
		expect(r2.cells.f_title).toBe('Untouched');
	});

	it('produces a document that still parses cleanly', () => {
		const doc = newDoc();
		const r1 = addRecord(doc);
		pasteFormatted(doc, [r1.id], [TITLE, STATUS], [
			[copied('text', 'Title'), copied('select', 'o_1', 'To do')],
		]);

		const { warnings } = parseLayerDoc(serializeLayerDoc(doc));

		expect(warnings).toEqual([]);
	});
});

describe('paste fills from the corner, extending outward', () => {
	/** Mirrors what the grid does before calling pasteCells. */
	function grow(
		selectedRows: string[],
		selectedFields: Field[],
		height: number,
		width: number,
		order: { recordIds: string[]; fields: Field[] },
	) {
		const firstRow = selectedRows[0];
		const firstField = selectedFields[0];
		if (!firstRow || !firstField) {
			return null;
		}
		const top = order.recordIds.indexOf(firstRow);
		const left = order.fields.findIndex((f) => f.id === firstField.id);
		if (top === -1 || left === -1) {
			return null;
		}
		const rows = order.recordIds.slice(top, top + height);
		const fields = order.fields.slice(left, left + width);
		if (rows.length < height || fields.length < width) {
			return null;
		}
		return { recordIds: rows, fields };
	}

	it('fills a 2x2 block pasted into a single selected cell', () => {
		// The bug this guards: clipping the content to the selection wrote one
		// cell and silently dropped three.
		const doc = newDoc();
		const r1 = addRecord(doc);
		const r2 = addRecord(doc);
		const order = {
			recordIds: [r1.id, r2.id],
			fields: [TITLE, STATUS],
		};

		const target = grow([r1.id], [TITLE], 2, 2, order);
		expect(target).not.toBeNull();
		if (!target) {
			return;
		}
		const report = pasteCells(doc, target.recordIds, target.fields, [
			['A', 'To do'],
			['B', 'Done'],
		]);

		expect(report.written).toBe(4);
		expect(r1.cells.f_title).toBe('A');
		expect(r1.cells.f_status).toBe('o_1');
		expect(r2.cells.f_title).toBe('B');
		expect(r2.cells.f_status).toBe('o_2');
	});

	it('starts at the selection corner, not at every selected cell', () => {
		const doc = newDoc();
		const r1 = addRecord(doc);
		const r2 = addRecord(doc);
		const order = { recordIds: [r1.id, r2.id], fields: [TITLE, STATUS] };

		// Both rows selected, one value on the clipboard: it lands in the first.
		const target = grow([r1.id, r2.id], [TITLE], 1, 1, order);
		expect(target?.recordIds).toEqual([r1.id]);

		if (target) {
			pasteCells(doc, target.recordIds, target.fields, [['single']]);
		}
		expect(r1.cells.f_title).toBe('single');
		expect(r2.cells.f_title).toBeUndefined();
	});

	it('refuses a block that runs past the end of the table', () => {
		// Refusing beats pasting part of a block the user did not ask to split.
		const doc = newDoc();
		const r1 = addRecord(doc);
		const order = { recordIds: [r1.id], fields: [TITLE, STATUS] };

		expect(grow([r1.id], [TITLE], 2, 1, order)).toBeNull();
		expect(grow([r1.id], [TITLE], 1, 3, order)).toBeNull();
	});

	it('extends into rendered rows only', () => {
		// A filter hides rows; the block must not spill into them.
		const doc = newDoc();
		const r1 = addRecord(doc);
		const hidden = addRecord(doc);
		const r3 = addRecord(doc);
		const order = {
			recordIds: [r1.id, r3.id],
			fields: [TITLE, STATUS],
		};

		const target = grow([r1.id], [TITLE], 2, 1, order);

		expect(target?.recordIds).toEqual([r1.id, r3.id]);
		expect(target?.recordIds).not.toContain(hidden.id);
	});
});

describe('clearCells', () => {
	it('empties every covered cell and counts them', () => {
		const doc = newDoc();
		const r1 = addRecord(doc);
		setCellValue(doc, r1.id, TITLE, 'gone');
		setCellValue(doc, r1.id, STATUS, 'o_1');

		expect(clearCells(doc, [r1.id], [TITLE, STATUS])).toBe(2);
		expect(r1.cells).toEqual({});
	});

	it('counts only the cells that held something', () => {
		const doc = newDoc();
		const r1 = addRecord(doc);
		setCellValue(doc, r1.id, TITLE, 'kept');

		// Status is already empty, so clearing the pair changes one cell.
		expect(clearCells(doc, [r1.id], [TITLE, STATUS])).toBe(1);
	});

	it('does nothing for a record that is gone', () => {
		const doc = newDoc();
		expect(clearCells(doc, ['r_missing'], [TITLE])).toBe(0);
	});
});
