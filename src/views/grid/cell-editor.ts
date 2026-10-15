import { t } from '../../i18n';
import type { CellValue, Field } from '../../types';

export interface CellEditOptions {
	field: Field;
	value: CellValue;
	commit: (value: CellValue) => void;
	restore: () => void;
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
		attachSelect(cell, field, options.value, finish);
	} else {
		attachTextInput(cell, options.value, finish);
	}

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
