import { describe, expect, it } from 'vitest';
import {
	createEmptyDoc,
	normalizeCellValue,
	parseLayerDoc,
	serializeLayerDoc,
} from '../src/io/schema';
import { LAYER_FORMAT_VERSION } from '../src/types';

const VALID = JSON.stringify({
	version: 1,
	name: '项目看板',
	fields: [
		{ id: 'f_a', name: '标题', type: 'text', primary: true },
		{
			id: 'f_b',
			name: '状态',
			type: 'select',
			options: [
				{ id: 'o_1', name: '待办', color: 'default' },
				{ id: 'o_2', name: '已完成', color: 'green' },
			],
		},
	],
	records: [
		{
			id: 'r_1',
			created: '2024-10-27T03:33:20.000Z',
			cells: { f_a: '写方案', f_b: 'o_1' },
		},
	],
	views: [
		{ id: 'v_1', name: '表格', type: 'grid' },
		{
			id: 'v_2',
			name: '看板',
			type: 'kanban',
			groupByFieldId: 'f_b',
			cardFieldIds: ['f_a'],
		},
	],
});

describe('parseLayerDoc', () => {
	it('parses a valid file without warnings', () => {
		const { doc, warnings } = parseLayerDoc(VALID);

		expect(warnings).toEqual([]);
		expect(doc.version).toBe(LAYER_FORMAT_VERSION);
		expect(doc.name).toBe('项目看板');
		expect(doc.fields).toHaveLength(2);
		expect(doc.records).toHaveLength(1);
		expect(doc.views.map((v) => v.type)).toEqual(['grid', 'kanban']);
	});

	it('round-trips through serialize without changing the data', () => {
		const first = parseLayerDoc(VALID).doc;
		const second = parseLayerDoc(serializeLayerDoc(first));

		expect(second.warnings).toEqual([]);
		expect(second.doc).toEqual(first);
	});

	describe('tolerates malformed input', () => {
		it('falls back to an empty board on invalid JSON', () => {
			const { doc, warnings } = parseLayerDoc('{ not json');

			expect(warnings.length).toBeGreaterThan(0);
			expect(doc.fields.length).toBeGreaterThan(0);
			expect(doc.records).toEqual([]);
		});

		it('falls back on a non-object payload', () => {
			const { warnings } = parseLayerDoc('"just a string"');

			expect(warnings.length).toBeGreaterThan(0);
		});

		it('keeps good fields and drops the bad ones', () => {
			const raw = JSON.parse(VALID) as Record<string, unknown>;
			(raw.fields as unknown[]).push({ id: 'f_x', name: '坏字段', type: 'nope' });
			const { doc, warnings } = parseLayerDoc(JSON.stringify(raw));

			expect(doc.fields.map((f) => f.id)).not.toContain('f_x');
			expect(doc.fields).toHaveLength(2);
			expect(warnings.some((w) => w.includes('could not be read'))).toBe(true);
		});

		it('keeps good records and drops the bad ones', () => {
			const raw = JSON.parse(VALID) as Record<string, unknown>;
			(raw.records as unknown[]).push({ id: 'r_2', cells: 'not an object' });
			const { doc } = parseLayerDoc(JSON.stringify(raw));

			expect(doc.records).toHaveLength(1);
			expect(doc.records[0]?.id).toBe('r_1');
		});
	});

	describe('protects the id-keyed data invariants', () => {
		it('drops cells pointing at fields that no longer exist', () => {
			const raw = JSON.parse(VALID) as Record<string, unknown>;
			(raw.records as Record<string, unknown>[])[0]!.cells = {
				f_a: '写方案',
				f_gone: '旧数据',
			};
			const { doc } = parseLayerDoc(JSON.stringify(raw));

			expect(doc.records[0]?.cells).toEqual({ f_a: '写方案' });
		});

		it('regenerates duplicate field ids so cells cannot collide', () => {
			const raw = JSON.parse(VALID) as Record<string, unknown>;
			(raw.fields as Record<string, unknown>[])[1]!.id = 'f_a';
			const { doc, warnings } = parseLayerDoc(JSON.stringify(raw));

			const ids = doc.fields.map((f) => f.id);
			expect(new Set(ids).size).toBe(ids.length);
			expect(warnings.length).toBeGreaterThan(0);
		});

		it('assigns a primary field when the file has none', () => {
			const raw = JSON.parse(VALID) as Record<string, unknown>;
			for (const field of raw.fields as Record<string, unknown>[]) {
				delete field.primary;
			}
			const { doc } = parseLayerDoc(JSON.stringify(raw));

			expect(doc.fields.filter((f) => f.primary)).toHaveLength(1);
			expect(doc.fields[0]?.primary).toBe(true);
		});

		it('keeps only one primary field', () => {
			const raw = JSON.parse(VALID) as Record<string, unknown>;
			(raw.fields as Record<string, unknown>[])[1]!.primary = true;
			const { doc } = parseLayerDoc(JSON.stringify(raw));

			expect(doc.fields.filter((f) => f.primary)).toHaveLength(1);
			expect(doc.fields[0]?.primary).toBe(true);
		});
	});

	describe('view validation', () => {
		it('keeps a board that groups by a column other than a choice', () => {
			/*
			 * A board may group by almost anything: a date gives one column per day, a
			 * number one per value. Only a column that is gone sends it back to the
			 * table, which the next case covers.
			 */
			const raw = JSON.parse(VALID) as Record<string, unknown>;
			(raw.views as Record<string, unknown>[])[1]!.groupByFieldId = 'f_a';
			const { doc } = parseLayerDoc(JSON.stringify(raw));

			expect(doc.views[1]?.type).toBe('kanban');
		});

		it('falls back to a grid view when the group field is missing', () => {
			const raw = JSON.parse(VALID) as Record<string, unknown>;
			(raw.views as Record<string, unknown>[])[1]!.groupByFieldId = 'f_gone';
			const { doc } = parseLayerDoc(JSON.stringify(raw));

			expect(doc.views[1]?.type).toBe('grid');
		});

		it('supplies default views when the file has none', () => {
			const { doc, warnings } = parseLayerDoc(JSON.stringify({ version: 1, fields: [], records: [] }));

			expect(doc.views.length).toBeGreaterThan(0);
			expect(warnings.some((w) => w.includes('usable view'))).toBe(true);
		});

		it('drops sorts and filters that reference unknown fields', () => {
			const raw = JSON.parse(VALID) as Record<string, unknown>;
			(raw.views as Record<string, unknown>[])[0]!.sorts = [{ fieldId: 'f_gone', order: 'asc' }];
			(raw.views as Record<string, unknown>[])[0]!.filter = {
				conjunction: 'and',
				conditions: [{ fieldId: 'f_gone', operator: 'is', value: 'x' }],
			};
			const { doc } = parseLayerDoc(JSON.stringify(raw));
			const grid = doc.views[0];

			expect(grid?.sorts).toEqual([]);
			expect(grid?.filter.conditions).toEqual([]);
		});

		it('drops conditions with an unknown operator', () => {
			const raw = JSON.parse(VALID) as Record<string, unknown>;
			(raw.views as Record<string, unknown>[])[0]!.filter = {
				conjunction: 'and',
				conditions: [{ fieldId: 'f_a', operator: 'soundsLike', value: 'x' }],
			};
			const { doc } = parseLayerDoc(JSON.stringify(raw));

			expect(doc.views[0]?.filter.conditions).toEqual([]);
		});
	});

	it('announces a version it was not written for', () => {
		const raw = JSON.parse(VALID) as Record<string, unknown>;
		raw.version = 99;
		const { doc, warnings } = parseLayerDoc(JSON.stringify(raw));

		expect(doc.version).toBe(LAYER_FORMAT_VERSION);
		expect(warnings.some((w) => w.includes('File version'))).toBe(true);
	});

	it('reports a missing version rather than assuming one', () => {
		const raw = JSON.parse(VALID) as Record<string, unknown>;
		delete raw.version;
		const { warnings } = parseLayerDoc(JSON.stringify(raw));

		expect(warnings.some((w) => w.includes('File version'))).toBe(true);
	});

	it('parses a current file without warnings', () => {
		const { warnings } = parseLayerDoc(VALID);

		expect(warnings).toEqual([]);
	});

	describe('self-describing header', () => {
		it('writes a header that a reader can act on', () => {
			const written = serializeLayerDoc(createEmptyDoc('Board'));
			const parsed = JSON.parse(written) as Record<string, unknown>;

			expect(parsed._format).toBe('obsidian-layer-base');
			expect(Array.isArray(parsed._note)).toBe(true);
			const notes = (parsed._note as string[]).join(' ');
			expect(notes).toMatch(/ISO 8601/);
			expect(notes).toMatch(/keyed by id/);
		});

		it('ignores the header when parsing', () => {
			const withHeader = serializeLayerDoc(createEmptyDoc('Board'));
			const { doc, warnings } = parseLayerDoc(withHeader);

			expect(warnings).toEqual([]);
			expect(doc.name).toBe('Board');
		});

		it('does not let the header become part of the document', () => {
			const withHeader = serializeLayerDoc(createEmptyDoc('Board'));
			const { doc } = parseLayerDoc(withHeader);

			expect(Object.keys(doc).sort()).toEqual([
				'fields',
				'name',
				'records',
				'version',
				'views',
			]);
		});
	});

	describe('created timestamp', () => {
		it('keeps an ISO string as-is', () => {
			const raw = JSON.parse(VALID) as Record<string, unknown>;
			(raw.records as Record<string, unknown>[])[0]!.created =
				'2024-10-28T02:13:20.000Z';
			const { doc } = parseLayerDoc(JSON.stringify(raw));

			expect(doc.records[0]?.created).toBe('2024-10-28T02:13:20.000Z');
		});

		it('rejects a legacy epoch number rather than converting it', () => {
			const raw = JSON.parse(VALID) as Record<string, unknown>;
			(raw.records as Record<string, unknown>[])[0]!.created = 1730000000000;
			const { doc } = parseLayerDoc(JSON.stringify(raw));

			expect(doc.records[0]?.created).toMatch(/^\d{4}-\d{2}-\d{2}T/);
			expect(doc.records[0]?.created).not.toBe('2024-10-27T03:33:20.000Z');
		});

		it('substitutes the current time for an unusable value', () => {
			const raw = JSON.parse(VALID) as Record<string, unknown>;
			(raw.records as Record<string, unknown>[])[0]!.created = 'not a date';
			const { doc } = parseLayerDoc(JSON.stringify(raw));

			expect(doc.records[0]?.created).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		});
	});
});

describe('normalizeCellValue', () => {
	it('keeps text as-is', () => {
		expect(normalizeCellValue('hi')).toBe('hi');
		expect(normalizeCellValue('')).toBe('');
	});

	it('turns numbers and booleans into text', () => {
		expect(normalizeCellValue(7)).toBe('7');
		expect(normalizeCellValue(true)).toBe('true');
	});

	it('empties anything with no honest text form', () => {
		expect(normalizeCellValue(null)).toBe('');
		expect(normalizeCellValue(undefined)).toBe('');
		expect(normalizeCellValue({ a: 1 })).toBe('');
		expect(normalizeCellValue(['a'])).toBe('');
		expect(normalizeCellValue(Number.NaN)).toBe('');
	});
});

describe('createEmptyDoc', () => {
	it('produces a board that parses back without warnings', () => {
		const { doc, warnings } = parseLayerDoc(serializeLayerDoc(createEmptyDoc('测试')));

		expect(warnings).toEqual([]);
		expect(doc.name).toBe('测试');
		expect(doc.fields.filter((f) => f.primary)).toHaveLength(1);
		// A new file opens as a table. Boards are added on purpose, from the row of
		// views, so nobody is handed an empty tab they did not ask for.
		expect(doc.views.map((v) => v.type)).toEqual(['grid']);
	});

	it('carries the choice field a new board would group by', () => {
		// The board is not created, but the column it would use is there, so adding
		// one takes a single click.
		const doc = createEmptyDoc();
		const select = doc.fields.find((f) => f.type === 'select');

		expect(select).toBeDefined();
		expect(select?.options?.length).toBeGreaterThan(0);
	});

	it('writes the supplied seed labels into the file', () => {
		const doc = createEmptyDoc('board', {
			untitledBoard: 'untitled',
			titleField: '标题',
			statusField: '状态',
			todoOption: '待办',
			inProgressOption: '进行中',
			doneOption: '已完成',
			gridView: '表格',
			kanbanView: '看板',
		});

		expect(doc.fields.map((f) => f.name)).toContain('标题');
		expect(doc.fields.map((f) => f.name)).toContain('状态');
		expect(doc.views.map((v) => v.name)).toEqual(['表格']);

		const status = doc.fields.find((f) => f.type === 'select');
		expect(status?.options?.map((o) => o.name)).toEqual([
			'待办',
			'进行中',
			'已完成',
		]);
	});

	it('uses English seed labels by default', () => {
		const doc = createEmptyDoc();
		expect(doc.fields.map((f) => f.name)).toEqual(['Title', 'Status']);
		expect(doc.views.map((v) => v.name)).toEqual(['Table']);
	});
});