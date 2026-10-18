import { setIcon } from 'obsidian';
import { t } from '../i18n';
import { FIELD_TYPES, specFor } from '../model/fields';
import type { FieldType } from '../types';
import { fieldTypeMatches, type FieldTypeChoice } from './field-type-choices';
import { SearchableDropdown, type DropdownItem } from './searchable-dropdown';

/** The rows, in the order they are offered, named for the active locale. */
function fieldTypeChoices(): FieldTypeChoice[] {
	const s = t();
	const label: Record<FieldType, string> = {
		text: s.typeText,
		longtext: s.typeLongText,
		number: s.typeNumber,
		date: s.typeDate,
		datetime: s.typeDateTime,
		relation: s.typeRelation,
		relationBack: s.typeRelationBack,
		select: s.typeSelect,
		multiSelect: s.typeMultiSelect,
		checkbox: s.typeCheckbox,
	};
	const hint: Record<FieldType, string> = {
		text: s.typeTextHint,
		longtext: s.typeLongTextHint,
		number: s.typeNumberHint,
		date: s.typeDateHint,
		datetime: s.typeDateTimeHint,
		relation: s.typeRelationHint,
		relationBack: s.typeRelationBackHint,
		select: s.typeSelectHint,
		multiSelect: s.typeMultiSelectHint,
		checkbox: s.typeCheckboxHint,
	};
	return FIELD_TYPES.map((type) => ({
		type,
		label: label[type],
		hint: hint[type],
	}));
}

/** The type list, hung off the button that opens it. */
export class FieldTypeDropdown {
	private readonly all = fieldTypeChoices();
	private readonly dropdown: SearchableDropdown;

	constructor(
		anchor: HTMLElement,
		private readonly current: FieldType,
		private readonly onPick: (type: FieldType) => void,
	) {
		this.dropdown = new SearchableDropdown({
			anchor,
			bodyClass: 'layer-type-dropdown',
			rowClass: 'layer-field-type-option',
			placeholder: t().fieldTypeSearch,
			emptyText: t().fieldTypeSearchNoMatch,
			items: (query): DropdownItem[] =>
				this.all
					.filter((choice) => fieldTypeMatches(choice, query))
					.map((choice) => ({
						key: choice.type,
						label: choice.label,
						hint: choice.hint,
						icon: specFor(choice.type).icon,
					})),
			selectedKey: () => this.current,
			renderRow: (row, item) => this.renderRow(row, item),
			onPick: (item) => this.onPick(item.key as FieldType),
		});
	}

	/**
	 * A type is a two-line row: the icon, then the name over its explanation.
	 * The core owns the row's classes, so only the contents are drawn here.
	 */
	private renderRow(row: HTMLElement, item: DropdownItem): void {
		if (item.icon) {
			setIcon(row.createSpan({ cls: 'layer-field-type-icon' }), item.icon);
		}
		const body = row.createSpan({ cls: 'layer-field-type-text' });
		body.createDiv({ cls: 'layer-field-type-label', text: item.label });
		body.createDiv({ cls: 'layer-field-type-hint', text: item.hint ?? '' });
	}

	/** Whether the list is currently on screen. */
	isOpen(): boolean {
		return this.dropdown.isOpen();
	}

	close(): void {
		this.dropdown.close();
	}
}
