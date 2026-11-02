import { describe, expect, it } from 'vitest';
import {
	colorRulesOf,
	rowColorOf,
	rowTint,
	setColorRules,
} from '../src/model/colors';
import {
	createEmptyDoc,
	parseLayerDoc,
	serializeLayerDoc,
} from '../src/io/schema';
import type { Field, GridView, LayerRecord } from '../src/types';

function setup(): {
	doc: ReturnType<typeof createEmptyDoc>;
	view: GridView;
	fields: Field[];
	field: Field;
	record: LayerRecord;
} {
	const doc = createEmptyDoc('Board');
	const view = doc.views.find((candidate) => candidate.type === 'grid');
	if (!view || view.type !== 'grid') {
		throw new Error('the seed board should contain a table view');
	}
	const field = doc.fields[0] as Field;
	const record: LayerRecord = {
		id: 'r_1',
		created: '2026-11-01T00:00:00.000Z',
		cells: { [field.id]: '基础设施' },
	};
	return { doc, view, fields: doc.fields, field, record };
}

describe('row colours', () => {
	it('leaves a row plain when no rule is set', () => {
		const { view, fields, record } = setup();

		expect(colorRulesOf(view)).toEqual([]);
		expect(rowColorOf(view, record, fields)).toBeNull();
	});

	it('paints a row whose condition holds', () => {
		const { view, fields, field, record } = setup();
		setColorRules(view, [
			{ fieldId: field.id, operator: 'contains', value: '基础', color: 'blue' },
		]);

		expect(rowColorOf(view, record, fields)).toBe('blue');
	});

	it('leaves a row alone whose condition does not hold', () => {
		const { view, fields, field, record } = setup();
		setColorRules(view, [
			{ fieldId: field.id, operator: 'contains', value: '别的', color: 'blue' },
		]);

		expect(rowColorOf(view, record, fields)).toBeNull();
	});

	it('takes the first rule that matches, not the last', () => {
		const { view, fields, field, record } = setup();
		setColorRules(view, [
			{ fieldId: field.id, operator: 'contains', value: '基础', color: 'red' },
			{ fieldId: field.id, operator: 'contains', value: '基础', color: 'blue' },
		]);

		expect(rowColorOf(view, record, fields)).toBe('red');
	});

	it('skips a rule for a column that is gone, and keeps looking', () => {
		const { view, fields, field, record } = setup();
		setColorRules(view, [
			{ fieldId: 'f_gone', operator: 'contains', value: '基础', color: 'red' },
			{ fieldId: field.id, operator: 'contains', value: '基础', color: 'blue' },
		]);

		expect(rowColorOf(view, record, fields)).toBe('blue');
	});

	it('drops the key when the last rule is removed', () => {
		const { view, field } = setup();
		setColorRules(view, [
			{ fieldId: field.id, operator: 'contains', value: 'x', color: 'blue' },
		]);

		setColorRules(view, []);

		expect('colorRules' in view).toBe(false);
	});
});

describe('colours survive a save and reload', () => {
	it('round-trips the rules', () => {
		const { doc, view, field } = setup();
		setColorRules(view, [
			{
				fieldId: field.id,
				operator: 'contains',
				value: '基础',
				color: 'purple',
			},
		]);

		const { doc: reloaded, warnings } = parseLayerDoc(serializeLayerDoc(doc));

		expect(warnings).toEqual([]);
		const grid = reloaded.views.find((candidate) => candidate.type === 'grid');
		expect(grid?.type === 'grid' ? colorRulesOf(grid) : null).toEqual([
			{
				fieldId: field.id,
				operator: 'contains',
				value: '基础',
				color: 'purple',
			},
		]);
	});

	it('drops a rule naming a colour this build does not have', () => {
		const { doc, field } = setup();
		const raw = JSON.parse(serializeLayerDoc(doc)) as {
			views: Record<string, unknown>[];
		};
		const grid = raw.views.find((candidate) => candidate.type === 'grid');
		if (grid) {
			grid.colorRules = [
				{ fieldId: field.id, operator: 'contains', value: 'x', color: 'chartreuse' },
				{ fieldId: field.id, operator: 'contains', value: 'x', color: 'green' },
			];
		}

		const { doc: reloaded } = parseLayerDoc(JSON.stringify(raw));
		const parsed = reloaded.views.find((candidate) => candidate.type === 'grid');

		expect(parsed?.type === 'grid' ? colorRulesOf(parsed) : null).toEqual([
			{ fieldId: field.id, operator: 'contains', value: 'x', color: 'green' },
		]);
	});
});

describe('rowTint', () => {
	it('turns a palette name into a see-through wash', () => {
		expect(rowTint('blue')).toBe('rgba(8, 109, 221, 0.14)');
	});

	it('falls back to grey rather than painting nothing', () => {
		expect(rowTint('chartreuse')).toBe('rgba(136, 136, 136, 0.14)');
	});
});
