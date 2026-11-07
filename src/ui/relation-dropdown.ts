import { t } from '../i18n';
import type { RelationCandidate } from '../model/relation';
import { SearchableDropdown, type DropdownItem } from './searchable-dropdown';

export interface RelationDropdownConfig {
	anchor: HTMLElement;
	candidates: readonly RelationCandidate[];
	/** The rows the cell already points at. */
	selectedIds: readonly string[];
	/** The chosen set, after each toggle. */
	onChange: (recordIds: string[]) => void;
	/** The panel closed. Every change was already reported as it was made. */
	onCancel: () => void;
}

const CLEAR_KEY = '\u0000clear';

/**
 * The picker for a relation cell: the rows of the source table that have a value
 * to offer, toggled as a set the way a multi-select is.
 *
 * It stays open while choices accumulate — the next click is another row, not a
 * dismissal — and reports the whole set after every change, so the cell behind
 * it keeps showing what it will hold.
 */
export function openRelationDropdown(config: RelationDropdownConfig): {
	close: () => void;
} {
	let chosen = [...config.selectedIds];
	let settled = false;

	const cancel = (): void => {
		if (settled) {
			return;
		}
		settled = true;
		/*
		 * Reported whether or not anything was chosen. The toggles were committed as
		 * they happened, so this is not an undo but the end of the panel — and it is
		 * the only word the editor hears: staying quiet after a change left the cell
		 * recorded as "being edited" for the rest of the session, and a repaint that
		 * arrives while that is true is dropped.
		 */
		config.onCancel();
	};

	const rowsFor = (query: string): DropdownItem[] => {
		const rows: DropdownItem[] = [];
		if (query === '' && chosen.length > 0) {
			rows.push({
				key: CLEAR_KEY,
				label: t().optionClearSelection,
				icon: 'eraser',
				modifier: 'is-clear',
			});
		}
		const needle = query.trim().toLowerCase();
		for (const candidate of config.candidates) {
			if (needle !== '' && !candidate.text.toLowerCase().includes(needle)) {
				continue;
			}
			const marked = chosen.includes(candidate.recordId);
			rows.push({
				key: candidate.recordId,
				label: candidate.text,
				icon: marked ? 'check-square' : 'square',
			});
		}
		return rows;
	};

	const dropdown = new SearchableDropdown({
		anchor: config.anchor,
		bodyClass: 'layer-option-dropdown',
		rowClass: 'layer-option-dropdown-row',
		placeholder: t().optionSearchPlaceholder,
		emptyText: t().optionSearchNoMatch,
		items: rowsFor,
		selectedKeys: (): readonly string[] => chosen,
		onPick: (item): void | 'keep-open' => {
			chosen =
				item.key === CLEAR_KEY
					? []
					: chosen.includes(item.key)
						? chosen.filter((id) => id !== item.key)
						: [...chosen, item.key];
			config.onChange(chosen);
			return 'keep-open';
		},
		onClose: cancel,
	});

	return { close: () => dropdown.close() };
}
