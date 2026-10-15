import { Menu } from 'obsidian';
import { t } from '../../i18n';
import type { Field } from '../../types';
import type { GridSelection } from './selection';

/**
 * Right-click menus for the table.
 *
 * Uses Obsidian's own `Menu`, so the popup inherits the active theme, keyboard
 * navigation, submenu behaviour and mobile presentation. A hand-rolled popup
 * would have to reimplement all of that and still look foreign.
 *
 * The menu is built per target rather than kept as one long list with disabled
 * entries: an action that does not apply to the clicked thing is simply absent.
 * A greyed-out row invites the user to wonder why it is unavailable.
 */

/**
 * What the user right-clicked, and the data needed to act on it.
 *
 * A right-click inside a selected range targets the *range*, not the single cell
 * under the pointer: selecting several cells is how someone asks for a bulk
 * operation, and answering with a one-cell menu would ignore what they just did.
 */
export type ContextTarget =
	| {
			kind: 'range';
			/** Cells covered, in rendered order, top-left first. */
			recordIds: string[];
			fields: Field[];
			/** True when every covered cell is already empty. */
			allEmpty: boolean;
	  }
	| { kind: 'row'; recordId: string; index: number; fields: Field[] }
	| { kind: 'column'; field: Field; isOnlyField: boolean };

export interface ContextMenuActions {
	/** Open the editor for an existing column's definition. */
	onEditField(field: Field): void;
	/** Duplicate a column's definition, without its values. */
	onDuplicateField(field: Field): void;
	/** Delete a column and its values. */
	onDeleteField(field: Field): void;
	/** Open the editor for a new column, inserted after `after`. */
	onInsertField(after: Field): void;
	/** Insert blank rows directly below a given one. */
	onInsertRecordsBelow(recordId: string, count: number): void;
	/** Duplicate rows, copying their cell values. */
	onDuplicateRecords(recordIds: string[]): void;
	/** Delete rows. */
	onDeleteRecords(recordIds: string[]): void;
	/** Report the current selection, for the status row. */
	onSelect(selection: GridSelection): void;

	/** Empty every cell of a range, or of one row. */
	onClearCells(recordIds: string[], fields: Field[]): void;
	/** Copy a range, so it can be pasted back as the same values. */
	onCopyRange(recordIds: string[], fields: Field[]): void;
	/** Paste into the range, extended to fit the clipboard. */
	onPasteInto(recordIds: string[], fields: Field[]): void;
	/** Fill every cell of the range with the first cell's value. */
	onFillRange(recordIds: string[], fields: Field[]): void;
}

/**
 * Builds and shows the menu for a right-clicked target.
 *
 * Only single-cell clipboard actions are offered. A "copy row" existed and was
 * removed: it wrote several values into one clipboard entry with no matching
 * paste, so the only thing a user could do with it was dump an entire row into
 * one text cell. Multi-cell copy belongs with multi-cell paste, and both want
 * the spreadsheet's tab-separated format rather than a separator of our own.
 */
export function showGridContextMenu(
	event: MouseEvent,
	target: ContextTarget,
	actions: ContextMenuActions,
): void {
	const menu = new Menu();

	// Right-clicking something also selects it, so the status row agrees with
	// what the menu is about to act on.
	actions.onSelect(selectionFor(target));

	switch (target.kind) {
		case 'range':
			buildRangeMenu(menu, target, actions);
			break;
		case 'row':
			buildRowMenu(menu, target, actions);
			break;
		case 'column':
			buildColumnMenu(menu, target, actions);
			break;
	}

	menu.showAtMouseEvent(event);
}

function selectionFor(target: ContextTarget): GridSelection {
	switch (target.kind) {
		case 'range': {
			// The menu acts on the range the user selected, so the selection is
			// restated from the target rather than invented from the pointer.
			const anchor = {
				recordId: target.recordIds[0] ?? '',
				fieldId: target.fields[0]?.id ?? '',
			};
			const lastRow = target.recordIds[target.recordIds.length - 1] ?? '';
			const lastField = target.fields[target.fields.length - 1]?.id ?? '';
			return {
				kind: 'range',
				anchor,
				focus: { recordId: lastRow, fieldId: lastField },
			};
		}
		case 'row':
			return { kind: 'row', recordId: target.recordId };
		case 'column':
			return { kind: 'column', fieldId: target.field.id };
	}
}

/**
 * The menu for a selected range.
 *
 * Only actions that mean something for every cell are listed. Renaming a column,
 * editing its type or deleting it are about the *column*, not the selection, so
 * they are absent here — a multi-cell selection cannot express "which column"
 * when it spans several.
 */
function buildRangeMenu(
	menu: Menu,
	target: Extract<ContextTarget, { kind: 'range' }>,
	actions: ContextMenuActions,
): void {
	const { recordIds, fields, allEmpty } = target;
	const cellCount = recordIds.length * fields.length;

	menu.addItem((item) =>
		item
			.setTitle(
				cellCount === 1
					? t().menuCellLabel
					: t().menuRangeLabel(recordIds.length, fields.length),
			)
			.setIsLabel(true),
	);
	menu.addSeparator();

	menu.addItem((item) =>
		item
			.setTitle(t().menuCopy)
			.setIcon('copy')
			// Nothing to copy from an entirely empty selection, so the entry is
			// absent rather than present and inert.
			.setDisabled(allEmpty)
			.onClick(() => actions.onCopyRange(recordIds, fields)),
	);
	menu.addItem((item) =>
		item
			.setTitle(t().menuPaste)
			.setIcon('clipboard-paste')
			/*
			 * Never disabled. What is on the clipboard cannot be known here: the
			 * system clipboard is only readable asynchronously, and content copied
			 * in another application is exactly what a paste should accept. Greying
			 * the entry out from our own buffer alone refused the text a user had
			 * just copied elsewhere — a paste that looks available and then says it
			 * has nothing beats one that looks unavailable while it would have
			 * worked.
			 */
			.onClick(() => actions.onPasteInto(recordIds, fields)),
	);
	menu.addSeparator();
	// Filling from one cell needs a cell to fill *from*, so it is a one-cell
	// idea that only becomes useful once a range is selected.
	menu.addItem((item) =>
		item
			.setTitle(t().menuFillRange)
			.setIcon('arrow-down-to-line')
			.setDisabled(cellCount < 2 || allEmpty)
			.onClick(() => actions.onFillRange(recordIds, fields)),
	);
	menu.addItem((item) =>
		item
			.setTitle(t().menuClearRange)
			.setIcon('eraser')
			.setDisabled(allEmpty)
			.onClick(() => actions.onClearCells(recordIds, fields)),
	);

	menu.addSeparator();
	// Row-level actions. Their titles state how many rows they touch, because a
	// selection spanning three rows must not be answered by a menu that silently
	// acts on one — which is what this menu used to do.
	const rowCount = recordIds.length;
	menu.addItem((item) =>
		item
			.setTitle(
				rowCount === 1
					? t().menuInsertRowBelow
					: t().menuInsertRowsBelow(rowCount),
			)
			.setIcon('plus')
			.onClick(() =>
				actions.onInsertRecordsBelow(recordIds[rowCount - 1] ?? '', rowCount),
			),
	);
	menu.addItem((item) =>
		item
			.setTitle(
				rowCount === 1
					? t().menuDuplicateRow
					: t().menuDuplicateRows(rowCount),
			)
			.setIcon('copy-plus')
			.onClick(() => actions.onDuplicateRecords(recordIds)),
	);
	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle(
				rowCount === 1 ? t().menuDeleteRow : t().menuDeleteRows(rowCount),
			)
			.setIcon('trash-2')
			.setWarning(true)
			.onClick(() => actions.onDeleteRecords(recordIds)),
	);
}

function buildRowMenu(
	menu: Menu,
	target: Extract<ContextTarget, { kind: 'row' }>,
	actions: ContextMenuActions,
): void {
	const { recordId, index, fields } = target;

	menu.addItem((item) =>
		item.setTitle(t().menuRowLabel(index + 1)).setIsLabel(true),
	);
	menu.addSeparator();

	// "Below" rather than "add": a row action should place the row where the
	// user is looking, not at the far end of a long board.
	menu.addItem((item) =>
		item
			.setTitle(t().menuInsertRowBelow)
			.setIcon('plus')
			.onClick(() => actions.onInsertRecordsBelow(recordId, 1)),
	);
	menu.addItem((item) =>
		item
			.setTitle(t().menuDuplicateRow)
			.setIcon('copy-plus')
			.onClick(() => actions.onDuplicateRecords([recordId])),
	);
	menu.addItem((item) =>
		item
			.setTitle(t().menuClearRow)
			.setIcon('eraser')
			// Clearing a row is clearing its cells, so it goes through the same
			// action a selected range uses rather than a parallel one.
			.onClick(() => actions.onClearCells([recordId], fields)),
	);
	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle(t().menuDeleteRow)
			.setIcon('trash-2')
			.setWarning(true)
			.onClick(() => actions.onDeleteRecords([recordId])),
	);
}

function buildColumnMenu(
	menu: Menu,
	target: Extract<ContextTarget, { kind: 'column' }>,
	actions: ContextMenuActions,
): void {
	const { field, isOnlyField } = target;

	menu.addItem((item) =>
		item.setTitle(t().menuColumnLabel(field.name)).setIsLabel(true),
	);
	menu.addSeparator();

	menu.addItem((item) =>
		item
			.setTitle(t().menuEditField)
			.setIcon('pencil')
			.onClick(() => actions.onEditField(field)),
	);
	// "Insert after" places the new column next to its anchor; appending would
	// put it at the far right of a wide board.
	menu.addItem((item) =>
		item
			.setTitle(t().menuInsertField)
			.setIcon('plus')
			.onClick(() => actions.onInsertField(field)),
	);
	menu.addItem((item) =>
		item
			.setTitle(t().menuDuplicateField)
			.setIcon('copy-plus')
			.onClick(() => actions.onDuplicateField(field)),
	);
	menu.addSeparator();
	menu.addItem((item) =>
		item
			.setTitle(t().menuDeleteField)
			.setIcon('trash-2')
			.setWarning(true)
			// The last column cannot go: a board with no fields has nothing to
			// show, and the parser would reinstate defaults on the next read.
			.setDisabled(isOnlyField)
			.onClick(() => actions.onDeleteField(field)),
	);
}
