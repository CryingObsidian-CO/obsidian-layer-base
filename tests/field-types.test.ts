import { describe, expect, it } from 'vitest';
import { createEmptyDoc, normalizeCellForField, parseLayerDoc, serializeLayerDoc } from '../src/io/schema';
import {
	FIELD_TYPES,
	cellFromText,
	cellToText,
	deserializeCellValue,
	emptyValueFor,
	formatCell,
	isEmptyCell,
	isMissingRequired,
	optionsOf,
	serializeCellValue,
	specFor,
	usesOptions,
} from '../src/model/fields';
import { addRecord, clearCells, setCellValue } from '../src/model/records';
import type { Field, LayerDoc, SelectOption } from '../src/types';

const OPTIONS: SelectOption[] = [
	{ id: 'o_1', name: 'To do', color: 'default' },
	{ id: 'o_2', name: 'Done', color: 'green' },
	{ id: 'o_3', name: 'Blocked', color: 'red' },
];

const multi: Field = { id: 'f_m', name: 'Tags', type: 'multiSelect', options: OPTIONS };
const box: Field = { id: 'f_c', name: 'Done', type: 'checkbox' };
const long: Field = { id: 'f_l', name: 'Notes', type: 'longtext' };

function docWith(fields: Field[]): LayerDoc {
	const doc = createEmptyDoc('Board');
	// The first field is the primary one, so parsing does not warn about a board
	// that has none — that warning is a different test's subject.
	doc.fields = fields.map((field, index) =>
		index === 0 ? { ...field, primary: true } : { ...field },
	);
	return doc;
}

describe('field types', () => {
	it('offers all five, text first', () => {
		expect([...FIELD_TYPES]).toEqual([
			'text',
			'longtext',
			'select',
			'multiSelect',
			'checkbox',
		]);
	});

	it('gives every type an icon', () => {
		for (const type of FIELD_TYPES) {
			expect(specFor(type).icon).toBeTruthy();
			expect(specFor(type).type).toBe(type);
		}
	});

	it('knows which types choose from options', () => {
		expect(usesOptions('select')).toBe(true);
		expect(usesOptions('multiSelect')).toBe(true);
		expect(usesOptions('text')).toBe(false);
		expect(usesOptions('longtext')).toBe(false);
		expect(usesOptions('checkbox')).toBe(false);
	});
});

describe('isEmptyCell', () => {
	it('reads an empty string as empty', () => {
		expect(isEmptyCell('')).toBe(true);
		expect(isEmptyCell('x')).toBe(false);
	});

	it('reads an empty set as empty, but a populated one as a value', () => {
		expect(isEmptyCell([])).toBe(true);
		expect(isEmptyCell(['o_1'])).toBe(false);
	});

	it('reads an unticked box as empty, so required can mean "must be ticked"', () => {
		expect(isEmptyCell(false)).toBe(true);
		expect(isEmptyCell(true)).toBe(false);
	});

	it('does not treat whitespace as empty', () => {
		expect(isEmptyCell(' ')).toBe(false);
	});
});

describe('emptyValueFor', () => {
	it('gives each type the empty value of its own shape', () => {
		expect(emptyValueFor(multi)).toEqual([]);
		expect(emptyValueFor(box)).toBe(false);
		expect(emptyValueFor(long)).toBe('');
	});

	it('produces a value each type then reads back as empty', () => {
		for (const field of [multi, box, long]) {
			expect(isEmptyCell(emptyValueFor(field))).toBe(true);
		}
	});
});

describe('multi-select values', () => {
	it('resolves ids to names in the field order, not the stored order', () => {
		expect(formatCell(multi, ['o_3', 'o_1'])).toBe('To do, Blocked');
	});

	it('drops ids the field no longer knows', () => {
		expect(optionsOf(multi, ['o_gone', 'o_2']).map((o) => o.name)).toEqual(['Done']);
		expect(formatCell(multi, ['o_gone'])).toBe('');
	});

	it('round trips through its text form', () => {
		const parsed = cellFromText(multi, 'To do, Blocked');
		expect(parsed).toEqual({ ok: true, value: ['o_1', 'o_3'] });
	});

	it('accepts names in any case and order', () => {
		expect(cellFromText(multi, ' blocked , to do ')).toEqual({
			ok: true,
			value: ['o_3', 'o_1'],
		});
	});

	it('does not repeat an option named twice', () => {
		expect(cellFromText(multi, 'Done, Done')).toEqual({ ok: true, value: ['o_2'] });
	});

	it('refuses a name that matches nothing, rather than silently dropping it', () => {
		expect(cellFromText(multi, 'To do, Nope')).toEqual({ ok: false });
	});

	it('reads blank text as the empty set', () => {
		expect(cellFromText(multi, '   ')).toEqual({ ok: true, value: [] });
	});
});

describe('checkbox values', () => {
	it('carries a real boolean, not a string', () => {
		expect(cellFromText(box, '')).toEqual({ ok: true, value: false });
		expect(cellFromText(box, 'true')).toEqual({ ok: true, value: true });
		expect(cellFromText(box, 'TRUE')).toEqual({ ok: true, value: true });
		expect(cellFromText(box, 'false')).toEqual({ ok: true, value: false });
	});

	it('takes the spellings a spreadsheet produces', () => {
		expect(cellFromText(box, 'yes')).toEqual({ ok: true, value: true });
		expect(cellFromText(box, '0')).toEqual({ ok: true, value: false });
	});

	it('refuses anything else', () => {
		expect(cellFromText(box, 'maybe')).toEqual({ ok: false });
	});

	it('reads a ticked box as text, and an unticked one as nothing', () => {
		expect(cellToText(box, true)).toBe('true');
		expect(cellToText(box, false)).toBe('');
	});
});

describe('serializeCellValue', () => {
	it('leaves a string as it is', () => {
		expect(serializeCellValue('hello')).toBe('hello');
	});

	it('keeps the shape of a set, so it cannot be confused with a joined string', () => {
		const raw = serializeCellValue(['o_1', 'o_2']);
		expect(raw).toBe('["o_1","o_2"]');
		expect(deserializeCellValue(raw, multi)).toEqual(['o_1', 'o_2']);
	});

	it('keeps a boolean distinguishable from the string "true"', () => {
		expect(deserializeCellValue(serializeCellValue(true), box)).toBe(true);
		expect(deserializeCellValue(serializeCellValue(''), box)).toBe(false);
	});

	it('round trips an empty set', () => {
		expect(deserializeCellValue(serializeCellValue([]), multi)).toEqual([]);
	});

	it('falls back to a comma list when the stored text is not JSON', () => {
		expect(deserializeCellValue('o_1,o_2', multi)).toEqual(['o_1', 'o_2']);
	});
});

describe('normalizeCellForField', () => {
	it('keeps only string ids in a set, and drops duplicates', () => {
		expect(normalizeCellForField(['o_1', 7, 'o_1', null, 'o_2'], 'multiSelect')).toEqual([
			'o_1',
			'o_2',
		]);
	});

	it('reads a non-array as an empty set rather than a wrong shape', () => {
		expect(normalizeCellForField('o_1', 'multiSelect')).toEqual([]);
		expect(normalizeCellForField(undefined, 'multiSelect')).toEqual([]);
	});

	it('keeps only a real boolean for a checkbox', () => {
		expect(normalizeCellForField(true, 'checkbox')).toBe(true);
		expect(normalizeCellForField(false, 'checkbox')).toBe(false);
		expect(normalizeCellForField('true', 'checkbox')).toBe(false);
	});

	it('still coerces text types to text', () => {
		expect(normalizeCellForField(7, 'text')).toBe('7');
		expect(normalizeCellForField('hi', 'longtext')).toBe('hi');
	});
});

describe('setCellValue shape guard', () => {
	it('refuses a string written into a multi-select cell', () => {
		const doc = docWith([multi]);
		const record = addRecord(doc);
		expect(setCellValue(doc, record.id, multi, 'o_1')).toBe(false);
		expect(record.cells.f_m).toBeUndefined();
	});

	it('refuses an array written into a checkbox cell', () => {
		const doc = docWith([box]);
		const record = addRecord(doc);
		expect(setCellValue(doc, record.id, box, ['o_1'])).toBe(false);
	});

	it('refuses a boolean written into a text cell', () => {
		const doc = docWith([long]);
		const record = addRecord(doc);
		expect(setCellValue(doc, record.id, long, true)).toBe(false);
	});

	it('accepts the right shape and stores it as given', () => {
		const doc = docWith([multi]);
		const record = addRecord(doc);
		expect(setCellValue(doc, record.id, multi, ['o_1', 'o_2'])).toBe(true);
		expect(record.cells.f_m).toEqual(['o_1', 'o_2']);
	});

	it('clears the key rather than storing an empty value', () => {
		const doc = docWith([box]);
		const record = addRecord(doc);
		setCellValue(doc, record.id, box, true);
		expect(record.cells.f_c).toBe(true);
		setCellValue(doc, record.id, box, false);
		expect('f_c' in record.cells).toBe(false);
	});
});

describe('clearing a cell uses the type own empty value', () => {
	it('clears a multi-select and a checkbox', () => {
		const doc = docWith([multi, box]);
		const record = addRecord(doc);
		setCellValue(doc, record.id, multi, ['o_1']);
		setCellValue(doc, record.id, box, true);

		expect(clearCells(doc, [record.id], [multi, box])).toBe(2);
		expect('f_m' in record.cells).toBe(false);
		expect('f_c' in record.cells).toBe(false);
	});
});

describe('required across the new types', () => {
	it('treats an unticked required box as missing', () => {
		expect(isMissingRequired({ ...box, required: true }, false)).toBe(true);
		expect(isMissingRequired({ ...box, required: true }, true)).toBe(false);
	});

	it('treats an empty required set as missing', () => {
		expect(isMissingRequired({ ...multi, required: true }, [])).toBe(true);
		expect(isMissingRequired({ ...multi, required: true }, ['o_1'])).toBe(false);
	});

	it('stays quiet on an optional field', () => {
		expect(isMissingRequired(box, false)).toBe(false);
	});
});

describe('round trip through the file', () => {
	it('keeps a multi-select field OPTIONS, not only its cells', () => {
		// The cells alone can survive a parse that drops the options — the ids are
		// still strings — but they then resolve to nothing and the next save writes
		// the field back with no options at all. So the options are asserted too.
		const doc = docWith([multi]);
		const record = addRecord(doc);
		record.cells.f_m = ['o_1', 'o_3'];

		const { doc: parsed } = parseLayerDoc(serializeLayerDoc(doc));
		const field = parsed.fields[0];
		expect(field?.type).toBe('multiSelect');
		expect(field?.options?.map((o) => o.id)).toEqual(['o_1', 'o_2', 'o_3']);
		expect(field?.options?.map((o) => o.name)).toEqual([
			'To do',
			'Done',
			'Blocked',
		]);
	});

	it('keeps the options of a single select too', () => {
		const single: Field = {
			id: 'f_s',
			name: 'Status',
			type: 'select',
			options: OPTIONS,
		};
		const doc = docWith([single]);
		const { doc: parsed } = parseLayerDoc(serializeLayerDoc(doc));
		expect(parsed.fields[0]?.options?.map((o) => o.id)).toEqual([
			'o_1',
			'o_2',
			'o_3',
		]);
	});

	it('survives a second round trip unchanged, so a reload cannot erode it', () => {
		const doc = docWith([multi, box]);
		const record = addRecord(doc);
		record.cells.f_m = ['o_2'];
		record.cells.f_c = true;

		const once = parseLayerDoc(serializeLayerDoc(doc)).doc;
		const twice = parseLayerDoc(serializeLayerDoc(once)).doc;
		expect(twice).toEqual(once);
		expect(twice.fields[0]?.options).toHaveLength(3);
		expect(twice.records[0]?.cells.f_m).toEqual(['o_2']);
	});

	it('keeps an array and a boolean as themselves', () => {
		const doc = docWith([multi, box, long]);
		const record = addRecord(doc);
		record.cells.f_m = ['o_1', 'o_3'];
		record.cells.f_c = true;
		record.cells.f_l = 'first\nsecond';

		const { doc: parsed, warnings } = parseLayerDoc(serializeLayerDoc(doc));
		expect(warnings).toEqual([]);
		expect(parsed.records[0]?.cells.f_m).toEqual(['o_1', 'o_3']);
		expect(parsed.records[0]?.cells.f_c).toBe(true);
		expect(parsed.records[0]?.cells.f_l).toBe('first\nsecond');
	});

	it('keeps line breaks in long text', () => {
		const doc = docWith([long]);
		const record = addRecord(doc);
		record.cells.f_l = 'a\n\nb';
		const { doc: parsed } = parseLayerDoc(serializeLayerDoc(doc));
		expect(parsed.records[0]?.cells.f_l).toBe('a\n\nb');
	});

	it('drops an unticked box instead of writing false', () => {
		const doc = docWith([box]);
		const record = addRecord(doc);
		record.cells.f_c = false;
		const text = serializeLayerDoc(doc);
		const { doc: parsed } = parseLayerDoc(text);
		expect('f_c' in (parsed.records[0]?.cells ?? {})).toBe(false);
	});

	it('repairs a wrong shape on load instead of trusting it', () => {
		const doc = docWith([multi, box]);
		const record = addRecord(doc);
		record.cells.f_m = ['o_1'];
		record.cells.f_c = true;
		const raw = JSON.parse(serializeLayerDoc(doc)) as {
			records: { cells: Record<string, unknown> }[];
		};
		raw.records[0]!.cells.f_m = 'o_1';
		raw.records[0]!.cells.f_c = 'true';

		const { doc: parsed } = parseLayerDoc(JSON.stringify(raw));
		expect('f_m' in (parsed.records[0]?.cells ?? {})).toBe(false);
		expect('f_c' in (parsed.records[0]?.cells ?? {})).toBe(false);
	});
});
