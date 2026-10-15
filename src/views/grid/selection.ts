/**
 * What is currently selected in a table.
 *
 * Selection is ephemeral UI state: it is never written to the `.layer` file and
 * is not part of `LayerDoc`. Reopening a board therefore starts with nothing
 * selected, which is the expected behaviour for a spreadsheet-style grid.
 *
 * A single cell is modelled as a range whose two ends are the same cell, rather
 * than as a separate kind. "Select this cell" and "select this rectangle" are one
 * operation; giving them two representations is how the two drift apart the first
 * time a rule applies to one and not the other.
 */

/** One cell of the grid, identified the way the document identifies it. */
export interface CellRef {
	recordId: string;
	fieldId: string;
}

export type GridSelection =
	/** A rectangle, held as the cell the drag began on plus the current end. */
	| { kind: 'range'; anchor: CellRef; focus: CellRef }
	| { kind: 'row'; recordId: string }
	| { kind: 'column'; fieldId: string };

/** A range resolved to positions, inclusive at both ends. */
export interface RangeBounds {
	top: number;
	bottom: number;
	left: number;
	right: number;
}

/**
 * Orders a range's two ends into a rectangle of row and column positions.
 *
 * The anchor is wherever the gesture started, so it can be below or right of the
 * focus; a rectangle needs its corners sorted. Positions come from the rendered
 * order rather than from ids, because that is what "the third row on screen"
 * means — and because a range must not include a row that a filter has hidden.
 *
 * Returns null when either end is no longer on screen, which happens if the
 * document changed mid-gesture.
 */
export function rangeBounds(
	anchor: CellRef,
	focus: CellRef,
	rowIndex: ReadonlyMap<string, number>,
	columnIndex: ReadonlyMap<string, number>,
): RangeBounds | null {
	const anchorRow = rowIndex.get(anchor.recordId);
	const focusRow = rowIndex.get(focus.recordId);
	const anchorColumn = columnIndex.get(anchor.fieldId);
	const focusColumn = columnIndex.get(focus.fieldId);

	if (
		anchorRow === undefined ||
		focusRow === undefined ||
		anchorColumn === undefined ||
		focusColumn === undefined
	) {
		return null;
	}

	return {
		top: Math.min(anchorRow, focusRow),
		bottom: Math.max(anchorRow, focusRow),
		left: Math.min(anchorColumn, focusColumn),
		right: Math.max(anchorColumn, focusColumn),
	};
}

/** How many rows and columns a range covers. */
export interface RangeSize {
	rows: number;
	columns: number;
}

export function rangeSize(bounds: RangeBounds): RangeSize {
	return {
		rows: bounds.bottom - bounds.top + 1,
		columns: bounds.right - bounds.left + 1,
	};
}

/**
 * Class applied to the elements a selection covers.
 *
 * One class per kind, rather than a single `is-selected`, because the kind
 * decides how the highlight is drawn. A shared class cannot express that: a
 * column selection tints a whole run of cells, while a range draws one border
 * around the whole rectangle and must not outline every cell in it.
 */
const SELECTION_CLASS: Record<GridSelection['kind'], string> = {
	range: 'is-sel-range',
	row: 'is-sel-row',
	column: 'is-sel-col',
};

const ALL_SELECTION_CLASSES = Object.values(SELECTION_CLASS);

/**
 * Applies the selection highlight to table elements.
 *
 * The tracker only touches the elements it previously highlighted rather than
 * scanning the table, so moving the selection on a wide board costs a handful of
 * class changes instead of a walk over every cell. It never re-renders: the
 * table is rebuilt only when the data changes.
 */
export class SelectionTracker {
	private current: GridSelection | null = null;
	private highlighted: HTMLElement[] = [];

	/**
	 * @param resolve Maps a selection to the elements it covers. The grid
	 * supplies this because it holds the element index built during render.
	 */
	constructor(private readonly resolve: (selection: GridSelection) => HTMLElement[]) {}

	get(): GridSelection | null {
		return this.current;
	}

	/** Sets the selection, or clears it when passed null. */
	apply(selection: GridSelection | null): void {
		for (const el of this.highlighted) {
			el.removeClass(...ALL_SELECTION_CLASSES);
		}
		this.highlighted = [];
		this.current = selection;

		if (!selection) {
			return;
		}
		// A selection can cover nothing: the row or column may have been
		// removed since it was made. That is not an error, it just means no
		// highlight is drawn.
		this.highlighted = this.resolve(selection);
		const cls = SELECTION_CLASS[selection.kind];
		for (const el of this.highlighted) {
			el.addClass(cls);
		}
	}

	/**
	 * Re-applies the current selection after the table was rebuilt.
	 *
	 * Called at the end of a render so a selection survives an operation that
	 * repaints — adding a row, or committing a field edit — instead of silently
	 * vanishing.
	 */
	refresh(): void {
		const selection = this.current;
		if (selection) {
			this.apply(selection);
		}
	}

	/** Drops the selection, e.g. when the rendered view changes. */
	clear(): void {
		this.apply(null);
	}
}
