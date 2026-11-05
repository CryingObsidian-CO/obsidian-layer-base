import type { GridView, LayerDoc } from '../types';

export const DEFAULT_COLUMN_WIDTH = 180;
export const MIN_COLUMN_WIDTH = 60;
export const MAX_COLUMN_WIDTH = 1600;

export const ROW_NUMBER_COLUMN_WIDTH = 30;

export const HEADER_HEIGHT = 32;
export const TAIL_COLUMN_WIDTH = HEADER_HEIGHT;

/*
 * A row's default height is what a table drawn before anyone chose a height uses,
 * so it has to be the height the standard preset names — otherwise a table that
 * was never set would match no preset and the list would show nothing ticked.
 */
export const DEFAULT_ROW_HEIGHT = 42;
export const MIN_ROW_HEIGHT = 24;
export const MAX_ROW_HEIGHT = 800;

function clamp(value: number, min: number, max: number): number {
	if (Number.isNaN(value)) {
		return min;
	}
	return Math.min(max, Math.max(min, Math.round(value)));
}

export function clampColumnWidth(width: number): number {
	return clamp(width, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH);
}

export function clampRowHeight(height: number): number {
	return clamp(height, MIN_ROW_HEIGHT, MAX_ROW_HEIGHT);
}

export function columnWidthOf(view: GridView, fieldId: string): number {
	return view.columnWidths[fieldId] ?? DEFAULT_COLUMN_WIDTH;
}

/**
 * The heights the row height list offers, in pixels.
 *
 * A preset is not a number typed by hand but a named choice, so the panel and the
 * file agree on what "comfortable" means even after the numbers are retuned.
 */
export const ROW_HEIGHTS = {
	compact: 24,
	standard: DEFAULT_ROW_HEIGHT,
	comfortable: 56,
} as const;

export type RowHeightPreset = keyof typeof ROW_HEIGHTS;

/** A row's height: its own if it was dragged, otherwise the view's base. */
export function rowHeightOf(view: GridView, recordId: string): number {
	return view.rowHeights[recordId] ?? view.rowHeight ?? DEFAULT_ROW_HEIGHT;
}

/**
 * Which preset the view is on, or null if the base is a height no preset names.
 *
 * Null rather than a guess: the panel ticks the preset in use and ticks none when
 * a hand-edited file asks for something between them.
 */
export function rowHeightPresetOf(view: GridView): RowHeightPreset | null {
	const height = view.rowHeight ?? DEFAULT_ROW_HEIGHT;
	const presets = Object.keys(ROW_HEIGHTS) as RowHeightPreset[];
	return presets.find((preset) => ROW_HEIGHTS[preset] === height) ?? null;
}

/**
 * Puts every row on one preset, undoing any row that was dragged.
 *
 * Choosing a height is a statement about the whole table, so rows dragged away
 * from the previous choice come back. That is also the only way back: dragging a
 * row is deliberately a one-row override, and nothing else clears it.
 */
export function setRowHeightPreset(
	view: GridView,
	preset: RowHeightPreset,
): void {
	const height = clampRowHeight(ROW_HEIGHTS[preset]);
	if (height === DEFAULT_ROW_HEIGHT) {
		delete view.rowHeight;
	} else {
		view.rowHeight = height;
	}
	for (const recordId of Object.keys(view.rowHeights)) {
		delete view.rowHeights[recordId];
	}
}

/** Whether this table lets a cell's values run onto more lines. */
export function wrapsOf(view: GridView): boolean {
	return view.wrap === true;
}

export function setWrap(view: GridView, wrap: boolean): void {
	if (wrap) {
		view.wrap = true;
	} else {
		delete view.wrap;
	}
}

export function setColumnWidth(
	view: GridView,
	fieldId: string,
	width: number,
): void {
	const clamped = clampColumnWidth(width);
	if (clamped === DEFAULT_COLUMN_WIDTH) {
		delete view.columnWidths[fieldId];
	} else {
		view.columnWidths[fieldId] = clamped;
	}
}

/**
 * The height one row was dragged to, or the key dropped when it is the table's.
 *
 * The comparison is against the height this view is actually drawing with, not
 * against the default: a row dragged to 42 in a table of 24-high rows is a row of
 * its own, and dropping the key would have snapped it back to 24 the moment it was
 * let go.
 */
export function setRowHeight(
	view: GridView,
	recordId: string,
	height: number,
): void {
	const clamped = clampRowHeight(height);
	const base = view.rowHeight ?? DEFAULT_ROW_HEIGHT;
	if (clamped === base) {
		delete view.rowHeights[recordId];
	} else {
		view.rowHeights[recordId] = clamped;
	}
}

export function findGridView(doc: LayerDoc, viewId: string): GridView | null {
	const view = doc.views.find((v) => v.id === viewId);
	return view && view.type === 'grid' ? view : null;
}

export function forgetFieldSize(view: GridView, fieldId: string): void {
	delete view.columnWidths[fieldId];
}

export function forgetRecordSize(view: GridView, recordId: string): void {
	delete view.rowHeights[recordId];
}
