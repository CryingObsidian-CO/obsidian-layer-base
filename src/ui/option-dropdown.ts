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
	/** Multi-select mode: rows toggle, the panel stays open, picks report the set. */
	multiple?: boolean;
	/** Creates the typed option; without it the create row only cancels. */
	onCreateOption?: (name: string) => SelectOption | null;
	/** An option was chosen; `''` clears the cell. */
	onPick: (optionId: string) => void;
	/** The whole chosen set, in multi-select mode. */
	onPickMany?: (optionIds: string[]) => void;
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
 *
 * In multi-select mode the same list behaves like a set of toggles, and stays
 * open, because the next click is another choice rather than a dismissal.
 */
export function openOptionDropdown(config: OptionDropdownConfig): {
	close: () => void;
} {
	const { field, selectedId } = config;
	const multiple = config.multiple === true;
	// Whether this dropdown already reported an outcome, so the close that
	// follows a pick never also reads as a cancel.
	let settled = false;
	// `selectedId` is a snapshot; each toggle replaces the working set.
	let chosen: string[] = multiple ? splitIds(selectedId) : [];

	const choose = (optionId: string): void => {
		settled = true;
		config.onPick(optionId);
	};

	const chooseMany = (optionIds: string[]): void => {
		chosen = optionIds;
		config.onPickMany?.(optionIds);
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
		const showClear =
			query === '' && (multiple ? chosen.length > 0 : selectedId !== '');
		const clearRow: DropdownItem = {
			key: 'clear',
			label: t().optionClearSelection,
			icon: 'eraser',
			modifier: 'is-clear',
		};
		/*
		 * Sited by whether the panel closes on a pick. A single choice closes, so
		 * its clear row sits at the top. A set stays open and the row APPEARS on
		 * the first choice — at the top that would shove every option down under
		 * the pointer mid-gesture, so it goes last, where it moves nothing.
		 */
		if (showClear && !multiple) {
			rows.push(clearRow);
		}
		for (const option of filterOptions(field.options, query)) {
			const marked = multiple
				? chosen.includes(option.id)
				: option.id === selectedId;
			rows.push({
				key: option.id,
				label: option.name,
				pillColor: option.color,
				// Unmarked rows leave the icon unset: the core draws the slot
				// either way, so the labels stay aligned. A set uses a filled
				// square so "listed" and "chosen" stay distinguishable; a single
				// choice needs no third state, so it keeps a tick.
				...(marked
					? { icon: multiple ? 'check-square' : 'check' }
					: multiple
						? { icon: 'square' }
						: {}),
			});
		}
		if (showClear && multiple) {
			rows.push(clearRow);
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
		// A single choice marks one row; a set marks a list of them.
		...(multiple
			? { selectedKeys: (): readonly string[] => chosen }
			: { selectedKey: (): string | null => selectedId }),
		onPick: (item, query): void | 'keep-open' => {
			if (item.key === 'clear') {
				if (multiple) {
					chooseMany([]);
					return 'keep-open';
				}
				choose('');
				return;
			}
			if (item.key === 'create') {
				const created = config.onCreateOption?.(normaliseOptionName(query));
				if (!created) {
					// Nothing was created, so there is no option to pick: report a
					// cancel rather than strand the cell in its editing state.
					cancel();
					return;
				}
				if (multiple) {
					chooseMany([...chosen, created.id]);
					return 'keep-open';
				}
				choose(created.id);
				return;
			}
			if (multiple) {
				chooseMany(
					chosen.includes(item.key)
						? chosen.filter((id) => id !== item.key)
						: [...chosen, item.key],
				);
				return 'keep-open';
			}
			choose(item.key);
			return;
		},
		onClose: cancel,
	});

	return {
		close: () => dropdown.close(),
	};
}

/** The ids in a `multiSelect` value, however it was handed over. */
function splitIds(value: string): string[] {
	if (value === '') {
		return [];
	}
	try {
		const parsed: unknown = JSON.parse(value);
		return Array.isArray(parsed)
			? parsed.filter((id): id is string => typeof id === 'string')
			: [];
	} catch {
		return value
			.split(',')
			.map((part) => part.trim())
			.filter((part) => part !== '');
	}
}
