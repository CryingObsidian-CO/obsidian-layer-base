import { t } from '../../i18n';
import type { CellValue, Field } from '../../types';

/**
 * In-place cell editing.
 *
 * The editor replaces the cell's contents and is removed once the value is
 * committed, so the grid itself never re-renders during an edit. That is the
 * whole point: rebuilding the table would tear out the focused input and drop
 * the caret mid-typing.
 *
 * One editor per field type, chosen here. A type whose value is entered some
 * other way adds its editor alongside itself rather than widening the text case.
 *
 * `keydown` events are stopped from propagating. Obsidian binds single keys to
 * global commands, and letting a keystroke escape from a focused input can
 * trigger a hotkey instead of typing a character.
 */

export interface CellEditOptions {
	field: Field;
	/** The value currently displayed in the cell. */
	value: CellValue;
	/** Called once with the new value. Not called when the edit is cancelled. */
	commit: (value: CellValue) => void;
	/** Restores the cell's normal rendering. */
	restore: () => void;
}

/** Starts editing a cell. Returns a function that tears the editor down. */
export function beginCellEdit(
	cell: HTMLElement,
	options: CellEditOptions,
): () => void {
	const { field } = options;
	cell.empty();
	cell.addClass('is-editing');

	let settled = false;
	const finish = (value: CellValue | undefined) => {
		if (settled) {
			return;
		}
		settled = true;
		cell.removeClass('is-editing');
		options.restore();
		if (value !== undefined) {
			options.commit(value);
		}
	};

	if (field.type === 'select') {
		attachSelect(cell, field, options.value, finish);
	} else {
		attachTextInput(cell, options.value, finish);
	}

	return () => finish(undefined);
}

type Finish = (value: CellValue | undefined) => void;

/** A text input committed on blur or Enter, cancelled on Escape. */
function attachTextInput(
	cell: HTMLElement,
	value: CellValue,
	finish: Finish,
): void {
	const input = cell.createEl('input', { cls: 'layer-grid-input' });
	input.type = 'text';
	input.value = value;

	// Focus after the element is in the DOM, and select existing text so typing
	// replaces it rather than appending.
	input.focus();
	input.select();

	input.addEventListener('keydown', (event) => {
		event.stopPropagation();
		if (event.key === 'Enter') {
			event.preventDefault();
			finish(input.value);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			finish(undefined);
		}
	});

	input.addEventListener('blur', () => {
		finish(input.value);
	});
}

/** A native select bound to the options of a `select` field. */
function attachSelect(
	cell: HTMLElement,
	field: Field,
	value: CellValue,
	finish: Finish,
): void {
	const select = cell.createEl('select', { cls: 'layer-grid-select' });

	select.createEl('option', { text: t().cellEmptyOption, value: '' });
	for (const option of field.options ?? []) {
		select.createEl('option', { text: option.name, value: option.id });
	}
	select.value = value;

	select.focus();
	// A select fires `change` on commit; blur alone would also fire it, so the
	// guard in `finish` keeps the callback single-shot.
	select.addEventListener('change', () => finish(select.value));
	select.addEventListener('keydown', (event) => {
		event.stopPropagation();
		if (event.key === 'Escape') {
			event.preventDefault();
			finish(undefined);
		}
	});
	select.addEventListener('blur', () => finish(select.value));
}
