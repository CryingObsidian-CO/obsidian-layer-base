import { serializeCellValue } from '../../model/fields';
import type { CellValue, Field, SelectOption } from '../../types';
import { openOptionDropdown } from '../../ui/option-dropdown';

export interface CellEditOptions {
	field: Field;
	value: CellValue;
	commit: (value: CellValue) => void;
	restore: () => void;
	/** Creates the option a typed name asks for; `null` when it cannot. */
	createOption: (name: string) => SelectOption | null;
}

/**
 * A live cell edit, so the grid can end one from the outside.
 *
 * `commit` keeps what the editor holds; `cancel` throws it away. A teardown
 * needs the first — text in an open editor has not reached the document yet.
 */
export interface CellEditHandle {
	cancel(): void;
	commit(): void;
}

export function beginCellEdit(
	cell: HTMLElement,
	options: CellEditOptions,
): CellEditHandle {
	const { field } = options;
	/*
	 * A checkbox has no editor: it toggles on a single press, and this must be
	 * answered before `cell.empty()` and before the text editor below, which a
	 * checkbox must never reach.
	 */
	if (field.type === 'checkbox') {
		return {
			cancel: () => undefined,
			commit: () => undefined,
		};
	}
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
		const dropdown = attachSelect(
			cell,
			field,
			options.value,
			options.createOption,
			finish,
		);
		return {
			cancel: () => {
				dropdown.close();
				finish(undefined);
			},
			// A picker reports its choice when it is made; nothing is held back.
			commit: () => {
				dropdown.close();
				finish(undefined);
			},
		};
	}

	if (field.type === 'multiSelect') {
		const dropdown = attachMultiSelect(
			cell,
			field,
			options.value,
			options.createOption,
			options.commit,
			finish,
		);
		return {
			cancel: () => {
				dropdown.close();
				finish(undefined);
			},
			// Each toggle was committed as it happened.
			commit: () => {
				dropdown.close();
				finish(undefined);
			},
		};
	}

	if (field.type === 'longtext') {
		const area = attachLongText(cell, options.value, finish);
		return {
			cancel: () => finish(undefined),
			commit: () => finish(area.value),
		};
	}

	const input = attachTextInput(cell, options.value, finish);
	return {
		cancel: () => finish(undefined),
		commit: () => finish(input.value),
	};
}

type Finish = (value: CellValue | undefined) => void;

function attachTextInput(
	cell: HTMLElement,
	value: CellValue,
	finish: Finish,
): HTMLInputElement {
	const input = cell.createEl('input', { cls: 'layer-grid-input' });
	input.type = 'text';
	input.value = typeof value === 'string' ? value : '';

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

	return input;
}

/**
 * The editor for `longtext`: a box several lines tall, opened over the cell.
 *
 * Enter inserts a newline here — the point of the type — so `Ctrl/Cmd+Enter`
 * commits. Its height is CSS's (`min-height`, `resize: vertical`), not a `rows`
 * attribute, because CSS also takes it out of flow so it cannot push the row.
 */
function attachLongText(
	cell: HTMLElement,
	value: CellValue,
	finish: Finish,
): HTMLTextAreaElement {
	const area = cell.createEl('textarea', { cls: 'layer-grid-longtext' });
	area.value = typeof value === 'string' ? value : '';

	area.focus();
	area.select();

	area.addEventListener('keydown', (event) => {
		event.stopPropagation();
		if (event.key === 'Escape') {
			event.preventDefault();
			finish(undefined);
			return;
		}
		if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
			event.preventDefault();
			finish(area.value);
		}
	});

	area.addEventListener('blur', () => {
		finish(area.value);
	});

	return area;
}

/**
 * Opens the option list on the cell and hands its outcome straight to `finish`.
 *
 * The panel owns the whole interaction — a pick, Escape, an outside click — and
 * reports exactly one of the two outcomes, so nothing here listens for blur.
 */
function attachSelect(
	cell: HTMLElement,
	field: Field,
	value: CellValue,
	createOption: (name: string) => SelectOption | null,
	finish: Finish,
): { close: () => void } {
	return openOptionDropdown({
		anchor: cell,
		field,
		selectedId: typeof value === 'string' ? value : '',
		onCreateOption: (name) => createOption(name),
		onPick: (optionId) => finish(optionId),
		onCancel: () => finish(undefined),
	});
}

/**
 * The multi-select editor: a list that stays open while choices accumulate.
 *
 * Each toggle commits through `commit` rather than `finish`, so the cell behind
 * the panel keeps showing the run of pills as it will look when closed. Safe
 * because the panel hangs off `document.body`, so repainting the cell cannot
 * take it down. The edit ends when the panel closes, which reports a cancel —
 * by then there is nothing left to commit.
 */
function attachMultiSelect(
	cell: HTMLElement,
	field: Field,
	value: CellValue,
	createOption: (name: string) => SelectOption | null,
	commit: (value: CellValue) => void,
	finish: Finish,
): { close: () => void } {
	return openOptionDropdown({
		anchor: cell,
		field,
		multiple: true,
		selectedId: serializeCellValue(value),
		onCreateOption: (name) => createOption(name),
		onPick: () => {
			// Never reached in multiple mode: every path reports through
			// `onPickMany`. Kept so the core's callback is always satisfied.
		},
		onPickMany: (optionIds) => commit(optionIds),
		onCancel: () => finish(undefined),
	});
}
