import { describe, expect, it } from 'vitest';
import { createEmptyDoc, parseLayerDoc, serializeLayerDoc } from '../src/io/schema';
import { isMissingRequired } from '../src/model/fields';
import { duplicateField } from '../src/model/records';
import type { Field, LayerDoc } from '../src/types';

function requiredText(over: Partial<Field> = {}): Field {
	return { id: 'f_a', name: 'Title', type: 'text', required: true, ...over };
}

function docWith(field: Field): LayerDoc {
	const doc = createEmptyDoc('Board');
	doc.fields = [field];
	return doc;
}

describe('isMissingRequired', () => {
	it('warns about a required field holding nothing', () => {
		expect(isMissingRequired(requiredText(), '')).toBe(true);
	});

	it('stays quiet once the cell holds a value', () => {
		expect(isMissingRequired(requiredText(), 'x')).toBe(false);
	});

	it('stays quiet for an optional field, however empty', () => {
		expect(isMissingRequired(requiredText({ required: false }), '')).toBe(false);
		expect(isMissingRequired({ id: 'f_b', name: 'Note', type: 'text' }, '')).toBe(
			false,
		);
	});

	it('treats a missing flag as optional, not as unknown', () => {
		const field: Field = { id: 'f_c', name: 'Note', type: 'text' };
		expect(field.required).toBeUndefined();
		expect(isMissingRequired(field, '')).toBe(false);
	});

	it('does not treat whitespace as empty, since the grid stores it verbatim', () => {
		expect(isMissingRequired(requiredText(), ' ')).toBe(false);
	});
});

describe('required round trip', () => {
	it('survives being written and read back', () => {
		const doc = docWith(requiredText({ primary: true }));
		const { doc: parsed, warnings } = parseLayerDoc(serializeLayerDoc(doc));
		expect(warnings).toEqual([]);
		expect(parsed.fields[0]?.required).toBe(true);
	});

	it('is not written when false, so no dead key reaches the file', () => {
		const doc = docWith({ id: 'f_a', name: 'Title', type: 'text', primary: true });
		const text = serializeLayerDoc(doc);
		expect(text).not.toContain('required');
		const { doc: parsed } = parseLayerDoc(text);
		expect(parsed.fields[0]?.required).toBeUndefined();
	});

	it('rejects a non-boolean, rather than trusting a hand-edited file', () => {
		const doc = docWith({ id: 'f_a', name: 'Title', type: 'text', primary: true });
		const raw = JSON.parse(serializeLayerDoc(doc)) as {
			fields: Record<string, unknown>[];
		};
		raw.fields[0]!.required = 'yes';
		const { doc: parsed } = parseLayerDoc(JSON.stringify(raw));
		expect(parsed.fields[0]?.required).toBeUndefined();
	});

	it('is carried onto a duplicated field', () => {
		const doc = docWith({ id: 'f_a', name: 'Title', type: 'text', primary: true });
		doc.fields[0]!.required = true;
		const copy = duplicateField(doc, 'f_a');
		expect(copy?.required).toBe(true);
	});

	it('is left off a duplicate of an optional field', () => {
		const doc = docWith({ id: 'f_a', name: 'Title', type: 'text', primary: true });
		const copy = duplicateField(doc, 'f_a');
		expect(copy?.required).toBeUndefined();
	});
});
