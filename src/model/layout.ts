import type { GridView, LayerDoc } from '../types';

/**
 * Column and row sizing for a table view.
 *
 * Sizes are stored per view, keyed by field or record id, and a missing key
 * means "use the default". That keeps a board small: only the columns someone
 * actually dragged carry a number, and everything else follows the defaults if
 * they ever change.
 *
 * The clamping lives here rather than in the drag handler so the bounds can be
 * tested directly — "how narrow may a column get" is a rule, not a mouse
 * gesture.
 */

export const DEFAULT_COLUMN_WIDTH = 180;
/** Narrower than this and the field name is unreadable. */
export const MIN_COLUMN_WIDTH = 60;
/** Wider than this and one column pushes every other off screen. */
export const MAX_COLUMN_WIDTH = 1600;

/**
 * The row-number gutter's width, in pixels. Not user-resizable.
 *
 * Declared here rather than in CSS so the table's total width can be computed
 * from one place. Two sources for a column width is how they drift apart.
 */
export const ROW_NUMBER_COLUMN_WIDTH = 30;

/**
 * The header row's height.
 *
 * Set explicitly so it matches the data rows, and so the add-column cell beside
 * the last column is square: its width and this height are the same number by
 * construction rather than by coincidence.
 *
 * Independent of a row's own height, which is per-record and draggable. A taller
 * record must not make the header taller.
 */
export const HEADER_HEIGHT = 32;

/** The add-column cell, square with the header row. Not user-resizable. */
export const TAIL_COLUMN_WIDTH = HEADER_HEIGHT;

export const DEFAULT_ROW_HEIGHT = 32;
/** Must fit the row number and a line of text. */
export const MIN_ROW_HEIGHT = 24;
export const MAX_ROW_HEIGHT = 800;

export function clampColumnWidth(width: number): number {
	return clamp(width, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH);
}

export function clampRowHeight(height: number): number {
	return clamp(height, MIN_ROW_HEIGHT, MAX_ROW_HEIGHT);
}

function clamp(value: number, min: number, max: number): number {
	// Only NaN defies interpretation; it has no place on a number line, so the
	// minimum is the safe answer. Infinities do have one, and clamping them
	// naturally lands on the matching bound — treating `Infinity` as "too
	// small" would be exactly backwards.
	if (Number.isNaN(value)) {
		return min;
	}
	return Math.min(max, Math.max(min, Math.round(value)));
}

/** The width to draw a column at, falling back to the default. */
export function columnWidthOf(view: GridView, fieldId: string): number {
	return view.columnWidths[fieldId] ?? DEFAULT_COLUMN_WIDTH;
}

/** The height to draw a row at, falling back to the default. */
export function rowHeightOf(view: GridView, recordId: string): number {
	return view.rowHeights[recordId] ?? DEFAULT_ROW_HEIGHT;
}

/**
 * Records a column's new width.
 *
 * Setting a column back to exactly the default removes the key instead of
 * storing the default number, so the file does not accumulate entries that say
 * nothing.
 */
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

/** Records a row's new height, dropping the key when it equals the default. */
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

/** Finds a table view by id. Returns null for a board view or an unknown id. */
export function findGridView(doc: LayerDoc, viewId: string): GridView | null {
	const view = doc.views.find((v) => v.id === viewId);
	return view && view.type === 'grid' ? view : null;
}

/**
 * Drops the stored sizes belonging to a field or record.
 *
 * Called from the same cascades that remove the field or record itself. A size
 * keyed by something that no longer exists is unreachable but permanent, and it
 * would silently apply again if an id were ever reused.
 */
export function forgetFieldSize(view: GridView, fieldId: string): void {
	delete view.columnWidths[fieldId];
}

export function forgetRecordSize(view: GridView, recordId: string): void {
	delete view.rowHeights[recordId];
}
