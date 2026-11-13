import { isReadOnly, relationIds, serializeCellValue } from '../../model/fields';
import {
	constrainNumber,
	parseNumberIn,
	sanitizeNumericInput,
} from '../../model/number';
import type { RelationCandidate } from '../../model/relation';
import type { CellValue, Field, SelectOption } from '../../types';
import { openOptionDropdown } from '../../ui/option-dropdown';
import { openRelationDropdown } from '../../ui/relation-dropdown';

export interface CellEditOptions {
	field: Field;
	value: CellValue;
	commit: (value: CellValue) => void;
	restore: () => void;
	createOption: (name: string) => SelectOption | null;
	relationCandidates?: () => readonly RelationCandidate[];
	// An editor ends itself, so without this the caller holds a handle for an edit that is over —
	// and a grid that thinks it is still editing drops every repaint it defers.
	onFinished?: () => void;
}

/** `commit` keeps what the editor holds: text in an open editor has not reached the document. */
export interface CellEditHandle {
	cancel(): void;
	commit(): void;
}

export function beginCellEdit(
	cell: HTMLElement,
	options: CellEditOptions,
): CellEditHandle | null {
	const { field } = options;
	// No editor, so no handle: one nobody can use still counts as an edit to the grid and keeps
	// the cell "being edited" forever, blocking every later repaint. A derived field stores
	// nothing and a checkbox toggles on one press; both are answered before `cell.empty()`.
	if (isReadOnly(field.type) || field.type === 'checkbox') {
		return null;
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
		options.onFinished?.();
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

	if (field.type === 'relation') {
		const dropdown = attachRelation(
			cell,
			options.value,
			options.relationCandidates?.() ?? [],
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

	if (field.type === 'number') {
		const input = attachNumberInput(cell, field, options.value, finish);
		return {
			cancel: () => finish(undefined),
			commit: () => finish(numberFromInput(input, field)),
		};
	}

	if (field.type === 'date' || field.type === 'datetime') {
		const input = attachDateInput(cell, field, options.value, finish);
		if (input === null) {
			// The control could not show the stored value, so there is no edit to keep: end it
			// rather than let a change or blur commit the empty string it fell back to.
			finish(undefined);
			return null;
		}
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

// Empty and invalid are kept apart: clearing a cell must clear it, while unparseable text is
// refused so nothing wrong reaches the document. `''` empties, `undefined` refuses.
function numberFromInput(
	input: HTMLInputElement,
	field: Field,
): CellValue | undefined {
	if (input.value.trim() === '') {
		return '';
	}
	const parsed = parseNumberIn(field, input.value);
	return parsed === null ? undefined : constrainNumber(parsed, field);
}

// Not `<input type="number">`: its spinner and its own notion of a valid value would disagree
// with the field's bounds and precision. Characters that cannot be in a number are dropped.
function attachNumberInput(
	cell: HTMLElement,
	field: Field,
	value: CellValue,
	finish: Finish,
): HTMLInputElement {
	const input = cell.createEl('input', { cls: 'layer-grid-input' });
	input.type = 'text';
	input.inputMode = 'decimal';
	// The bare number, not its display text: the `%` of a percent field is not there to delete.
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

/** The native control's value is already the stored form; an empty control means an empty cell. */
function attachDateInput(
	cell: HTMLElement,
	field: Field,
	value: CellValue,
	finish: Finish,
): HTMLInputElement | null {
	const input = cell.createEl('input', { cls: 'layer-grid-input' });
	input.type = field.type === 'datetime' ? 'datetime-local' : 'date';
	const stored = typeof value === 'string' ? value : '';
	input.value = stored;
	// A native date control silently empties itself on text it cannot represent, and the model
	// accepts a wider range (year 0000). Null says the edit never began — the change and blur
	// handlers would otherwise commit '' over a value the reader never touched.
	if (stored !== '' && input.value === '') {
		return null;
	}

	input.focus();
	openPicker(input);

	// A pick reports through `change`; the edit ends there rather than on a later click away.
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

// Called synchronously from the double-click: `showPicker` needs a user gesture. A browser that
// refuses is no reason to fail the edit, since the control's own button still works.
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

// Enter inserts a newline — the point of the type — so Ctrl/Cmd+Enter commits. Height is CSS's
// (`min-height`, `resize: vertical`) rather than `rows`, because CSS also takes it out of flow.
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

/** The panel owns the interaction and reports exactly one outcome, so nothing here listens for blur. */
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

// Each toggle commits rather than finishes, so the cell behind keeps showing its pills; safe
// because the panel hangs off `document.body`, so repainting the cell cannot take it down. The
// edit ends when the panel closes, which reports a cancel — by then nothing is left to commit.
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
			// Never reached in multiple mode; kept so the core's callback is always satisfied.
		},
		onPickMany: (optionIds) => commit(optionIds),
		onCancel: () => finish(undefined),
	});
}

/** Toggles commit immediately, like the multi-select: the panel stays open. */
function attachRelation(
	cell: HTMLElement,
	value: CellValue,
	candidates: readonly RelationCandidate[],
	commit: (value: CellValue) => void,
	finish: Finish,
): { close: () => void } {
	return openRelationDropdown({
		anchor: cell,
		candidates,
		selectedIds: relationIds(value),
		onChange: (recordIds) => commit(recordIds),
		onCancel: () => finish(undefined),
	});
}
