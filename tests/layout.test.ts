import { describe, expect, it } from 'vitest';
import {
	DEFAULT_COLUMN_WIDTH,
	DEFAULT_ROW_HEIGHT,
	MAX_COLUMN_WIDTH,
	MAX_ROW_HEIGHT,
	MIN_COLUMN_WIDTH,
	MIN_ROW_HEIGHT,
	ROW_HEIGHTS,
	clampColumnWidth,
	clampRowHeight,
	columnWidthOf,
	rowHeightOf,
	rowHeightPresetOf,
	setColumnWidth,
	setRowHeight,
	setRowHeightPreset,
	setWrap,
	wrapsOf,
} from '../src/model/layout';
import { removeField, removeRecord, addRecord } from '../src/model/records';
import { createEmptyDoc, parseLayerDoc, serializeLayerDoc } from '../src/io/schema';
import type { GridView, LayerDoc } from '../src/types';

function newDoc(): { doc: LayerDoc; view: GridView } {
	const doc = createEmptyDoc('Board');
	const view = doc.views.find((v) => v.type === 'grid');
	if (!view || view.type !== 'grid') {
		throw new Error('the seed board should contain a table view');
	}
	return { doc, view };
}

describe('clamping', () => {
	it('holds a column between its bounds', () => {
		expect(clampColumnWidth(10)).toBe(MIN_COLUMN_WIDTH);
		expect(clampColumnWidth(99999)).toBe(MAX_COLUMN_WIDTH);
		expect(clampColumnWidth(240)).toBe(240);
	});

	it('holds a row between its bounds', () => {
		expect(clampRowHeight(1)).toBe(MIN_ROW_HEIGHT);
		expect(clampRowHeight(99999)).toBe(MAX_ROW_HEIGHT);
		expect(clampRowHeight(48)).toBe(48);
	});

	it('rounds to whole pixels', () => {
		expect(clampColumnWidth(200.6)).toBe(201);
	});

	it('treats a non-number as the minimum rather than writing NaN', () => {
		expect(clampColumnWidth(Number.NaN)).toBe(MIN_COLUMN_WIDTH);
		expect(clampRowHeight(Number.POSITIVE_INFINITY)).toBe(MAX_ROW_HEIGHT);
	});
});

describe('defaults', () => {
	it('reports the default for a column with no stored width', () => {
		const { view } = newDoc();
		expect(columnWidthOf(view, 'f_anything')).toBe(DEFAULT_COLUMN_WIDTH);
	});

	it('reports the default for a row with no stored height', () => {
		const { view } = newDoc();
		expect(rowHeightOf(view, 'r_anything')).toBe(DEFAULT_ROW_HEIGHT);
	});
});

describe('setColumnWidth', () => {
	it('stores a dragged width', () => {
		const { view } = newDoc();

		setColumnWidth(view, 'f_a', 260);

		expect(view.columnWidths.f_a).toBe(260);
		expect(columnWidthOf(view, 'f_a')).toBe(260);
	});

	it('drops the key when the width returns to the default', () => {
		const { view } = newDoc();
		setColumnWidth(view, 'f_a', 260);
		setColumnWidth(view, 'f_a', DEFAULT_COLUMN_WIDTH);

		expect('f_a' in view.columnWidths).toBe(false);
	});

	it('clamps before storing', () => {
		const { view } = newDoc();
		setColumnWidth(view, 'f_a', 5);

		expect(view.columnWidths.f_a).toBe(MIN_COLUMN_WIDTH);
	});
});

describe('setRowHeight', () => {
	it('stores a dragged height', () => {
		const { view } = newDoc();
		setRowHeight(view, 'r_a', 80);

		expect(view.rowHeights.r_a).toBe(80);
		expect(rowHeightOf(view, 'r_a')).toBe(80);
	});

	it('drops the key when the height returns to the default', () => {
		const { view } = newDoc();
		setRowHeight(view, 'r_a', 80);
		setRowHeight(view, 'r_a', DEFAULT_ROW_HEIGHT);

		expect('r_a' in view.rowHeights).toBe(false);
	});

	it('keeps a row dragged to the default height when the table is not on it', () => {
		const { view } = newDoc();
		setRowHeightPreset(view, 'compact');
		setRowHeight(view, 'r_a', DEFAULT_ROW_HEIGHT);

		// 42 in a table of 24-high rows is a row of its own; dropping the key here would snap it back to 24.
		expect(view.rowHeights.r_a).toBe(DEFAULT_ROW_HEIGHT);
		expect(rowHeightOf(view, 'r_a')).toBe(DEFAULT_ROW_HEIGHT);
	});

	it('drops the key when the height returns to the base it belongs to', () => {
		const { view } = newDoc();
		setRowHeightPreset(view, 'compact');
		setRowHeight(view, 'r_a', 80);
		setRowHeight(view, 'r_a', ROW_HEIGHTS.compact);

		expect('r_a' in view.rowHeights).toBe(false);
		expect(rowHeightOf(view, 'r_a')).toBe(ROW_HEIGHTS.compact);
	});
});

describe('sizes follow their field and record', () => {
	it('drops a column width when the column is deleted', () => {
		const { doc, view } = newDoc();
		const fieldId = doc.fields[0]!.id;
		setColumnWidth(view, fieldId, 260);

		removeField(doc, fieldId);

		expect(fieldId in view.columnWidths).toBe(false);
	});

	it('drops a row height when the row is deleted', () => {
		const { doc, view } = newDoc();
		const record = addRecord(doc);
		setRowHeight(view, record.id, 80);

		removeRecord(doc, record.id);

		expect(record.id in view.rowHeights).toBe(false);
	});
});

describe('row height presets', () => {
	it('puts every row on the chosen height', () => {
		const { doc, view } = newDoc();
		const record = addRecord(doc);

		setRowHeightPreset(view, 'comfortable');

		expect(rowHeightOf(view, record.id)).toBe(ROW_HEIGHTS.comfortable);
		expect(rowHeightPresetOf(view)).toBe('comfortable');
	});

	it('lets a dragged row outrank the preset', () => {
		const { doc, view } = newDoc();
		const dragged = addRecord(doc);
		const untouched = addRecord(doc);
		setRowHeightPreset(view, 'compact');

		setRowHeight(view, dragged.id, 120);

		expect(rowHeightOf(view, dragged.id)).toBe(120);
		expect(rowHeightOf(view, untouched.id)).toBe(ROW_HEIGHTS.compact);
	});

	it('brings dragged rows back when a preset is chosen again', () => {
		const { doc, view } = newDoc();
		const dragged = addRecord(doc);
		setRowHeightPreset(view, 'compact');
		setRowHeight(view, dragged.id, 120);

		setRowHeightPreset(view, 'compact');

		expect(rowHeightOf(view, dragged.id)).toBe(ROW_HEIGHTS.compact);
		expect(view.rowHeights).toEqual({});
	});

	it('stores nothing for the default height', () => {
		const { view } = newDoc();
		setRowHeightPreset(view, 'comfortable');

		setRowHeightPreset(view, 'standard');

		expect('rowHeight' in view).toBe(false);
		expect(rowHeightPresetOf(view)).toBe('standard');
	});

	it('names no preset for a height that is none of them', () => {
		const { view } = newDoc();
		view.rowHeight = 37;

		expect(rowHeightPresetOf(view)).toBeNull();
	});
});

describe('the base row height survives a save and reload', () => {
	it('round-trips the chosen height', () => {
		const { doc, view } = newDoc();
		setRowHeightPreset(view, 'comfortable');

		const { doc: reloaded, warnings } = parseLayerDoc(serializeLayerDoc(doc));

		expect(warnings).toEqual([]);
		const grid = reloaded.views.find((v) => v.type === 'grid');
		expect(grid?.type === 'grid' ? grid.rowHeight : null).toBe(
			ROW_HEIGHTS.comfortable,
		);
	});

	it('ignores a height that is not a number', () => {
		const raw = JSON.parse(serializeLayerDoc(createEmptyDoc('Board'))) as {
			views: Record<string, unknown>[];
		};
		const grid = raw.views.find((v) => v.type === 'grid');
		if (grid) {
			grid.rowHeight = 'tall';
		}

		const { doc } = parseLayerDoc(JSON.stringify(raw));
		const reloaded = doc.views.find((v) => v.type === 'grid');

		expect(reloaded?.type === 'grid' ? reloaded.rowHeight : 'missing').toBe(
			undefined,
		);
	});
});

describe('the standard height is the default', () => {
	/* A table that never chose a height reports the default while the list ticks whichever preset names that number; drift leaves every table with nothing ticked. */
	it('names the default height with the standard preset', () => {
		expect(ROW_HEIGHTS.standard).toBe(DEFAULT_ROW_HEIGHT);
	});

	it('leaves a freshly made table on the standard height', () => {
		const { view } = newDoc();

		expect(rowHeightPresetOf(view)).toBe('standard');
	});

	it('offers the heights shortest first', () => {
		expect(ROW_HEIGHTS.compact).toBeLessThan(ROW_HEIGHTS.standard);
		expect(ROW_HEIGHTS.standard).toBeLessThan(ROW_HEIGHTS.comfortable);
	});
});

describe('wrapping values', () => {
	it('is on for a table that was just made', () => {
		const { view } = newDoc();

		expect(wrapsOf(view)).toBe(true);
	});

	it('stores the choice and drops the key when turned back on', () => {
		const { view } = newDoc();

		setWrap(view, false);
		expect(wrapsOf(view)).toBe(false);
		expect('wrap' in view).toBe(false);

		setWrap(view, true);
		expect(wrapsOf(view)).toBe(true);
	});

	it('keeps a turned-off table off after a save and reload', () => {
		const { doc, view } = newDoc();
		setWrap(view, false);

		const { doc: reloaded } = parseLayerDoc(serializeLayerDoc(doc));
		const grid = reloaded.views.find((v) => v.type === 'grid');

		expect(grid?.type === 'grid' ? wrapsOf(grid) : null).toBe(false);
	});
});

describe('sizes survive a save and reload', () => {
	it('round-trips stored sizes', () => {
		const { doc, view } = newDoc();
		const record = addRecord(doc);
		setColumnWidth(view, doc.fields[0]!.id, 260);
		setRowHeight(view, record.id, 80);

		const { doc: reloaded, warnings } = parseLayerDoc(serializeLayerDoc(doc));

		expect(warnings).toEqual([]);
		const grid = reloaded.views.find((v) => v.type === 'grid');
		expect(grid?.type === 'grid' ? grid.columnWidths[doc.fields[0]!.id] : null).toBe(260);
		expect(grid?.type === 'grid' ? grid.rowHeights[record.id] : null).toBe(80);
	});

	it('drops a size whose field or record is gone', () => {
		const raw = JSON.parse(serializeLayerDoc(createEmptyDoc('Board'))) as {
			views: Record<string, unknown>[];
		};
		const grid = raw.views.find((v) => v.type === 'grid');
		if (grid) {
			grid.columnWidths = { f_gone: 300 };
			grid.rowHeights = { r_gone: 90 };
		}

		const { doc } = parseLayerDoc(JSON.stringify(raw));
		const reloaded = doc.views.find((v) => v.type === 'grid');

		expect(reloaded?.type === 'grid' ? reloaded.columnWidths : null).toEqual({});
		expect(reloaded?.type === 'grid' ? reloaded.rowHeights : null).toEqual({});
	});

	it('ignores sizes that are not positive numbers', () => {
		const raw = JSON.parse(serializeLayerDoc(createEmptyDoc('Board'))) as {
			fields: { id: string }[];
			views: Record<string, unknown>[];
		};
		const columnId = raw.fields[0]!.id;
		const grid = raw.views.find((v) => v.type === 'grid');
		if (grid) {
			grid.columnWidths = {
				[columnId]: 'wide',
				[`${columnId}_b`]: -5,
			};
		}

		const { doc } = parseLayerDoc(JSON.stringify(raw));
		const reloaded = doc.views.find((v) => v.type === 'grid');

		expect(reloaded?.type === 'grid' ? reloaded.columnWidths : null).toEqual({});
	});
});
