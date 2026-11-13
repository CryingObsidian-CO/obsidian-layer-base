import { t } from '../i18n';
import type { RelationCandidate } from '../model/relation';
import { SearchableDropdown, type DropdownItem } from './searchable-dropdown';

export interface RelationDropdownConfig {
	anchor: HTMLElement;
	candidates: readonly RelationCandidate[];
	selectedIds: readonly string[];
	onChange: (recordIds: string[]) => void;
	/** Closed; every change was already reported as it was made. */
	onCancel: () => void;
}

const CLEAR_KEY = '\u0000clear';

/** Toggles accumulate and the panel stays open; the whole set is reported after every change. */
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
		// Reported whether or not anything was chosen: it is the only word the editor hears
		// that the cell is no longer being edited, and a repaint while that is true is dropped.
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
