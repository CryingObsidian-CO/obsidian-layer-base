export interface CellRef {
	recordId: string;
	fieldId: string;
}

export type GridSelection =
	| { kind: 'range'; anchor: CellRef; focus: CellRef }
	| { kind: 'row'; recordId: string }
	| { kind: 'column'; fieldId: string };

export interface RangeBounds {
	top: number;
	bottom: number;
	left: number;
	right: number;
}

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

/** Null for an empty grid: with no rendered cell there is nothing to anchor to. */
export function wholeTableCorners(
	rowIds: readonly string[],
	fieldIds: readonly string[],
): Extract<GridSelection, { kind: 'range' }> | null {
	const firstRow = rowIds[0];
	const lastRow = rowIds[rowIds.length - 1];
	const firstField = fieldIds[0];
	const lastField = fieldIds[fieldIds.length - 1];

	if (firstRow === undefined || lastRow === undefined) {
		return null;
	}
	if (firstField === undefined || lastField === undefined) {
		return null;
	}

	return {
		kind: 'range',
		anchor: {recordId: firstRow, fieldId: firstField},
		focus: {recordId: lastRow, fieldId: lastField},
	};
}

const SELECTION_CLASS: Record<GridSelection['kind'], string> = {
	range: 'is-sel-range',
	row: 'is-sel-row',
	column: 'is-sel-col',
};

const ALL_SELECTION_CLASSES = Object.values(SELECTION_CLASS);

export class SelectionTracker {
	private current: GridSelection | null = null;
	private highlighted: HTMLElement[] = [];

	constructor(private readonly resolve: (selection: GridSelection) => HTMLElement[]) {}

	get(): GridSelection | null {
		return this.current;
	}

	apply(selection: GridSelection | null): void {
		for (const el of this.highlighted) {
			el.removeClass(...ALL_SELECTION_CLASSES);
		}
		this.highlighted = [];
		this.current = selection;

		if (!selection) {
			return;
		}
		this.highlighted = this.resolve(selection);
		const cls = SELECTION_CLASS[selection.kind];
		for (const el of this.highlighted) {
			el.addClass(cls);
		}
	}

	refresh(): void {
		const selection = this.current;
		if (selection) {
			this.apply(selection);
		}
	}

	clear(): void {
		this.apply(null);
	}
}
