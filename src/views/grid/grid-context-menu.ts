import { Menu } from 'obsidian';
import { t } from '../../i18n';
import type { Field } from '../../types';
import type { GridSelection } from './selection';

export type ContextTarget =
	| {
			kind: 'range';
			recordIds: string[];
			fields: Field[];
			allEmpty: boolean;
	  }
	| {
			kind: 'row';
			recordId: string;
			/** The 1-based number the row header shows, not a list position. */
			index: number;
			fields: Field[];
	  }
	| { kind: 'column'; field: Field; isOnlyField: boolean };

export interface ContextMenuActions {
	onEditField(field: Field, at: { x: number; y: number } | null): void;
	onDuplicateField(field: Field): void;
	onDeleteField(field: Field): void;
	onInsertField(after: Field): void;
	onInsertRecordsBelow(recordId: string, count: number): void;
	onDuplicateRecords(recordIds: string[]): void;
	onDeleteRecords(recordIds: string[]): void;
	onSelect(selection: GridSelection): void;
	onClearRecord(recordId: string): void;
	onClearCells(recordIds: string[], fields: Field[]): void;
	onCopyRange(recordIds: string[], fields: Field[]): void;
	onPasteInto(recordIds: string[], fields: Field[]): void;
	onFillRange(recordIds: string[], fields: Field[]): void;
}

export function showGridContextMenu(
	event: MouseEvent,
	target: ContextTarget,
	actions: ContextMenuActions,
): void {
	const menu = new Menu();

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
			.setDisabled(allEmpty)
			.onClick(() => actions.onCopyRange(recordIds, fields)),
	);
	menu.addItem((item) =>
		item
			.setTitle(t().menuPaste)
			.setIcon('clipboard-paste')
			.onClick(() => actions.onPasteInto(recordIds, fields)),
	);
	menu.addSeparator();
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
	const { recordId, index } = target;

	menu.addItem((item) =>
		item.setTitle(t().menuRowLabel(index)).setIsLabel(true),
	);
	menu.addSeparator();

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
			.onClick(() => actions.onClearRecord(recordId)),
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
			.onClick((evt) => {
				// No coordinates when the menu is activated from the keyboard.
				const at =
					evt instanceof MouseEvent
						? { x: evt.clientX, y: evt.clientY }
						: null;
				actions.onEditField(field, at);
			}),
	);
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
			.setDisabled(isOnlyField)
			.onClick(() => actions.onDeleteField(field)),
	);
}
