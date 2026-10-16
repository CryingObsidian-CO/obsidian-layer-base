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
		const dropdown = attachSelect(
			cell,
			field,
			options.value,
			options.createOption,
			finish,
		);
		return () => {
			// Closing reports the cancel by itself; the `finish` after it only
			// covers a panel that had already closed on its own, and is
			// swallowed by the guard when the close did report.
			dropdown.close();
			finish(undefined);
		};
	}

	attachTextInput(cell, options.value, finish);

	return () => finish(undefined);
}

type Finish = (value: CellValue | undefined) => void;

function attachTextInput(
	cell: HTMLElement,
	value: CellValue,
	finish: Finish,
): void {
	const input = cell.createEl('input', { cls: 'layer-grid-input' });
	input.type = 'text';
	input.value = value;

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

/**
 * Opens the option list on the cell and hands its outcome straight to `finish`.
 *
 * The panel owns the whole interaction — a pick, Escape, an outside click — and
 * reports exactly one of the two outcomes, so nothing here listens for blur: the
 * native `<select>` this replaced committed on both `change` and `blur`, which
 * wrote the same value twice. The cell stays `is-editing` until `finish` runs,
 * which is what keeps range drag from treating it as a drag handle meanwhile.
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
		selectedId: value,
		onCreateOption: (name) => createOption(name),
		onPick: (optionId) => finish(optionId),
		onCancel: () => finish(undefined),
	});
}
