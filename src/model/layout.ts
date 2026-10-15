import type { GridView, LayerDoc } from '../types';

export const DEFAULT_COLUMN_WIDTH = 180;
export const MIN_COLUMN_WIDTH = 60;
export const MAX_COLUMN_WIDTH = 1600;

export const ROW_NUMBER_COLUMN_WIDTH = 30;

export const HEADER_HEIGHT = 32;
export const TAIL_COLUMN_WIDTH = HEADER_HEIGHT;

export const DEFAULT_ROW_HEIGHT = 32;
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

export function rowHeightOf(view: GridView, recordId: string): number {
	return view.rowHeights[recordId] ?? DEFAULT_ROW_HEIGHT;
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

export function setRowHeight(
	view: GridView,
	recordId: string,
	height: number,
): void {
	const clamped = clampRowHeight(height);
	if (clamped === DEFAULT_ROW_HEIGHT) {
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
