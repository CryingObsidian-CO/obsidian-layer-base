import { t } from '../i18n';
import {
	filterOptions,
	findOptionByName,
	normaliseOptionName,
} from '../model/select-options';
import type { Field, SelectOption } from '../types';
import { SearchableDropdown, type DropdownItem } from './searchable-dropdown';

/** Everything the cell editor hands over to open the option list. */
export interface OptionDropdownConfig {
	anchor: HTMLElement;
	field: Field;
	selectedId: string;
	/** Creates the typed option; without it the create row only cancels. */
	onCreateOption?: (name: string) => SelectOption | null;
	/** An option was chosen; `''` clears the cell. */
	onPick: (optionId: string) => void;
	/** The list was closed without a pick. */
	onCancel: () => void;
}

/**
 * The option list for a select cell: the field's options, a way to clear the
 * cell, and a way to create an option by typing one that does not exist yet.
 *
 * Rows are rebuilt for every query, and the offer is narrowed down to what
 * makes sense for it: clearing belongs to the untouched list, and creating
 * belongs to a query that matches nothing — offering it while the cell is
 * still untouched would create an option out of nothing.
 */
export function openOptionDropdown(config: OptionDropdownConfig): {
	close: () => void;
} {
	const { field, selectedId } = config;
	// Whether this dropdown already reported an outcome, so the close that
	// follows a pick never also reads as a cancel.
	let settled = false;

	const choose = (optionId: string): void => {
		settled = true;
		config.onPick(optionId);
	};

	const cancel = (): void => {
		if (!settled) {
			settled = true;
			config.onCancel();
		}
	};

	const rowsFor = (query: string): DropdownItem[] => {
		const rows: DropdownItem[] = [];
		// An untouched query is the whole list, which is the only place clearing
		// makes sense. Any typing at all drops it, even a query the option list
		// still shows in full: from then on the user is searching, not choosing
		// between the current value and nothing.
		if (query === '' && selectedId !== '') {
			rows.push({
				key: 'clear',
				label: t().optionClearSelection,
				icon: 'eraser',
				modifier: 'is-clear',
			});
		}
		for (const option of filterOptions(field.options, query)) {
			rows.push({
				key: option.id,
				label: option.name,
				pillColor: option.color,
				// The current value is ticked. Rows without the tick leave the
				// icon unset rather than empty: the core's default renderer
				// draws the slot for every row either way, so an unticked row
				// keeps the gutter and the labels stay aligned.
				...(option.id === selectedId ? { icon: 'check' } : {}),
			});
		}
		const name = normaliseOptionName(query);
		if (name !== '' && !findOptionByName(field, name)) {
			rows.push({
				key: 'create',
				label: t().optionCreate(name),
				icon: 'plus',
				modifier: 'is-create',
			});
		}
		return rows;
	};

	const dropdown = new SearchableDropdown({
		anchor: config.anchor,
		bodyClass: 'layer-option-dropdown',
		rowClass: 'layer-option-dropdown-row',
		placeholder: t().optionSearchPlaceholder,
		emptyText: field.options?.length
			? t().optionSearchNoMatch
			: t().optionEmptyHint,
		items: rowsFor,
		selectedKey: () => selectedId,
		onPick: (item, query) => {
			if (item.key === 'clear') {
				choose('');
				return;
			}
			if (item.key === 'create') {
				const created = config.onCreateOption?.(normaliseOptionName(query));
				if (created) {
					choose(created.id);
					return;
				}
				// Nothing was created, so this is a cancel: there is no option to
				// pick, and leaving the caller without either outcome would strand
				// the cell in its editing state.
				cancel();
				return;
			}
			choose(item.key);
		},
		onClose: cancel,
	});

	return {
		close: () => dropdown.close(),
	};
}
