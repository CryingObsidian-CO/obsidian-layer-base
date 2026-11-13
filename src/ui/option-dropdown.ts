import { t } from '../i18n';
import {
	filterOptions,
	findOptionByName,
	normaliseOptionName,
} from '../model/select-options';
import type { Field, SelectOption } from '../types';
import { SearchableDropdown, type DropdownItem } from './searchable-dropdown';

export interface OptionDropdownConfig {
	anchor: HTMLElement;
	field: Field;
	selectedId: string;
	/** Rows toggle and the panel stays open; picks report the whole set. */
	multiple?: boolean;
	/** Without this, the create row only cancels. */
	onCreateOption?: (name: string) => SelectOption | null;
	onPick: (optionId: string) => void;
	onPickMany?: (optionIds: string[]) => void;
	/** Closed without a pick. */
	onCancel: () => void;
}

/** Clearing belongs to the untouched list; creating to a query that matches nothing. */
export function openOptionDropdown(config: OptionDropdownConfig): {
	close: () => void;
} {
	const { field, selectedId } = config;
	const multiple = config.multiple === true;
	// So the close that follows a pick never also reads as a cancel.
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
		// Untouched query only: any typing means searching, even when the list still shows in full.
		const showClear =
			query === '' && (multiple ? chosen.length > 0 : selectedId !== '');
		const clearRow: DropdownItem = {
			key: 'clear',
			label: t().optionClearSelection,
			icon: 'eraser',
			modifier: 'is-clear',
		};
		// Sited by whether a pick closes the panel. In multi-select it appears on the first
		// choice, and at the top that would shove rows down under the pointer mid-gesture.
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
				// Unmarked rows leave the icon unset so the core still draws the slot and the
				// labels stay aligned. A set uses a square, so "listed" and "chosen" differ.
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
					// No option to pick, so report a cancel rather than strand the cell editing.
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

/** A multiSelect value is JSON, or a comma list written by something older. */
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
