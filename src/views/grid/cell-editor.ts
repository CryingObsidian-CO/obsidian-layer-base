import { serializeCellValue } from '../../model/fields';
import {
	constrainNumber,
	parseNumber,
	sanitizeNumericInput,
} from '../../model/number';
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

	if (field.type === 'number') {
		const input = attachNumberInput(cell, field, options.value, finish);
		return {
			cancel: () => finish(undefined),
			commit: () => finish(numberFromInput(input, field)),
		};
	}

	if (field.type === 'date' || field.type === 'datetime') {
		const input = attachDateInput(cell, field, options.value, finish);
		return {
			cancel: () => finish(undefined),
			// The control's own value is already the stored form, and `''` clears.
			commit: () => finish(input.value),
		};
	}

	const input = attachTextInput(cell, options.value, finish);
	return {
		cancel: () => finish(undefined),
		commit: () => finish(input.value),
	};
}

type Finish = (value: CellValue | undefined) => void;

/**
 * What a numeric input means: a number held inside the field's bounds, `''` when
 * the box was emptied, and `undefined` when the text is not a number at all.
 *
 * Empty and invalid are kept apart on purpose — clearing a cell must clear it,
 * while unparseable text is refused so nothing wrong reaches the document.
 */
function numberFromInput(
	input: HTMLInputElement,
	field: Field,
): CellValue | undefined {
	if (input.value.trim() === '') {
		return '';
	}
	const parsed = parseNumber(input.value);
	return parsed === null ? undefined : constrainNumber(parsed, field);
}

/**
 * The editor for `number`: a text box that only ever holds what can be a number.
 *
 * Not an `<input type="number">`, because its spinner and its own notion of a
 * valid value would disagree with the field's bounds and precision. Characters
 * that cannot be part of a number are dropped as they are typed, and the text is
 * still parsed strictly when the edit ends.
 */
function attachNumberInput(
	cell: HTMLElement,
	field: Field,
	value: CellValue,
	finish: Finish,
): HTMLInputElement {
	const input = cell.createEl('input', { cls: 'layer-grid-input' });
	input.type = 'text';
	input.inputMode = 'decimal';
	// The bare number, not its display text: the `%` of a percent field is not
	// something to select and delete before typing.
	input.value = typeof value === 'number' ? String(value) : '';

	input.focus();
	input.select();

	const commit = (): void => {
		finish(numberFromInput(input, field));
	};

	input.addEventListener('input', () => {
		const cleaned = sanitizeNumericInput(input.value);
		if (cleaned === input.value) {
			return;
		}
		// Rewriting the value moves the caret to the end, so it is put back.
		const caret = input.selectionStart ?? cleaned.length;
		input.value = cleaned;
		const next = Math.min(caret, cleaned.length);
		input.setSelectionRange(next, next);
	});

	input.addEventListener('keydown', (event) => {
		event.stopPropagation();
		if (event.key === 'Enter') {
			event.preventDefault();
			commit();
		} else if (event.key === 'Escape') {
			event.preventDefault();
			finish(undefined);
		}
	});

	input.addEventListener('blur', commit);

	return input;
}

/**
 * The editor for `date` and `datetime`: the browser's own control, which brings
 * a calendar (and a time field) along with it.
 *
 * Its value is already the stored form — `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` for
 * `datetime-local` — so nothing has to be parsed or converted here, and an empty
 * control means an empty cell.
 */
function attachDateInput(
	cell: HTMLElement,
	field: Field,
	value: CellValue,
	finish: Finish,
): HTMLInputElement {
	const input = cell.createEl('input', { cls: 'layer-grid-input' });
	input.type = field.type === 'datetime' ? 'datetime-local' : 'date';
	input.value = typeof value === 'string' ? value : '';

	input.focus();
	openPicker(input);

	// A picker reports a choice through `input`/`change`; the edit ends on the
	// same gesture rather than making the user click away from the calendar.
	input.addEventListener('change', () => {
		finish(input.value);
	});

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
 * Opens the control's calendar straight away, so a double-click edits a date by
 * picking one instead of hunting for the small button at the input's edge.
 *
 * Called synchronously from the double-click, which is what makes it allowed:
 * `showPicker` refuses to open without a user gesture. A browser that refuses
 * anyway is not a reason to fail the edit — the button still works.
 */
function openPicker(input: HTMLInputElement): void {
	const picker = input as HTMLInputElement & { showPicker?: () => void };
	if (typeof picker.showPicker !== 'function') {
		return;
	}
	try {
		picker.showPicker.call(input);
	} catch {
		// Refused (no gesture, or unsupported): the control is still usable.
	}
}

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
