import type { GridView, LayerDoc } from '../types';

export const DEFAULT_COLUMN_WIDTH = 180;
export const MIN_COLUMN_WIDTH = 60;
export const MAX_COLUMN_WIDTH = 1600;

export const ROW_NUMBER_COLUMN_WIDTH = 30;

export const HEADER_HEIGHT = 32;
/* The right-end column holds the add-field button, so its width is its own. */
export const TAIL_COLUMN_WIDTH = 32;

/*
 * Must equal the standard preset's height: an unset table then matches a preset, and the height
 * list ticks one rather than none.
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

/** Named choices, not typed numbers: the panel and the file agree on what "comfortable" means. */
export const ROW_HEIGHTS = {
	compact: 24,
	standard: DEFAULT_ROW_HEIGHT,
	comfortable: 56,
} as const;

export type RowHeightPreset = keyof typeof ROW_HEIGHTS;

export function rowHeightOf(view: GridView, recordId: string): number {
	return view.rowHeights[recordId] ?? view.rowHeight ?? DEFAULT_ROW_HEIGHT;
}

/** Null rather than a guess when a hand-edited file sits between presets; the panel then ticks none. */
export function rowHeightPresetOf(view: GridView): RowHeightPreset | null {
	const height = view.rowHeight ?? DEFAULT_ROW_HEIGHT;
	const presets = Object.keys(ROW_HEIGHTS) as RowHeightPreset[];
	return presets.find((preset) => ROW_HEIGHTS[preset] === height) ?? null;
}

/**
 * Choosing a height is a statement about the whole table, so dragged rows are reset; dragging a
 * row is a one-row override, and this is the only thing that clears it.
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
 * Compare against the height this view draws with, not the default: a row dragged to 42 in a
 * 24-high table is a row of its own, and dropping the key would snap it back on release.
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
