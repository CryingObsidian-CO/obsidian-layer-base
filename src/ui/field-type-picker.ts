import { setIcon } from 'obsidian';
import { t } from '../i18n';
import { FIELD_TYPES, specFor } from '../model/fields';
import type { FieldType } from '../types';
import { placeAtAnchor } from './anchor-placement';
import { fieldTypeMatches, type FieldTypeChoice } from './field-type-choices';

/** The rows, in the order they are offered, named for the active locale. */
function fieldTypeChoices(): FieldTypeChoice[] {
	const s = t();
	const label: Record<FieldType, string> = {
		text: s.typeText,
		select: s.typeSelect,
	};
	const hint: Record<FieldType, string> = {
		text: s.typeTextHint,
		select: s.typeSelectHint,
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
	private readonly el: HTMLElement;
	private readonly listEl: HTMLElement;
	private readonly inputEl: HTMLInputElement;
	private filtered: FieldTypeChoice[] = [];
	private active = 0;

	private readonly anchor: HTMLElement;

	constructor(
		anchor: HTMLElement,
		private readonly current: FieldType,
		private readonly onPick: (type: FieldType) => void,
	) {
		this.anchor = anchor;
		// Inside the modal's focus scope, but a sibling of `.modal`, whose
		// scrolling box would otherwise clip the list.
		const host = anchor.closest('.modal-container') ?? document.body;
		this.el = host.createDiv({ cls: 'layer-type-dropdown' });
		this.el.setAttribute('role', 'listbox');

		this.inputEl = this.el.createEl('input', {
			cls: 'layer-type-dropdown-input',
			type: 'text',
			placeholder: t().fieldTypeSearch,
		});
		this.listEl = this.el.createDiv({ cls: 'layer-type-dropdown-list' });
		this.el.addEventListener('mousedown', (event) => event.stopPropagation());
		this.inputEl.addEventListener('input', () => this.refresh());
		this.inputEl.addEventListener('keydown', (event) => this.onKey(event));

		this.applySearch('');

		// Displayed first: a hidden element measures as zero and would always be
		// placed below. Off-screen while measuring, so it cannot flash.
		this.el.addClass('is-measuring');
		window.setTimeout(() => {
			const anchorRect = this.anchor.getBoundingClientRect();
			this.el.style.width = `${anchorRect.width}px`;
			placeAtAnchor(this.el, anchorRect, this.el.getBoundingClientRect());
			this.el.removeClass('is-measuring');
			this.el.addClass('is-open');
			this.inputEl.focus();
		}, 0);

		// Deferred, so the click that opened this does not immediately close it.
		window.setTimeout(() => {
			document.addEventListener('mousedown', this.onOutsideClick);
			window.addEventListener('blur', this.onWindowBlur);
		}, 0);
	}

	private readonly onOutsideClick = (event: MouseEvent): void => {
		const target = event.target;
		if (target instanceof Node && !this.el.contains(target)) {
			this.close();
		}
	};

	private readonly onWindowBlur = (): void => {
		this.close();
	};

	/** Applies a search query and repaints the rows. */
	private refresh(): void {
		this.applySearch(this.inputEl.value);
	}

	private applySearch(query: string): void {
		this.filtered = this.all.filter((choice) => fieldTypeMatches(choice, query));
		this.active = this.filtered.findIndex((choice) => choice.type === this.current);
		if (this.active < 0) {
			this.active = 0;
		}
		this.render();
	}

	private render(): void {
		this.listEl.empty();
		if (this.filtered.length === 0) {
			this.listEl.createDiv({
				cls: 'layer-type-dropdown-empty',
				text: t().fieldTypeSearchNoMatch,
			});
			return;
		}
		this.filtered.forEach((choice, index) => {
			const row = this.listEl.createDiv({ cls: 'layer-field-type-option' });
			if (choice.type === this.current) {
				row.addClass('is-selected');
			}
			setIcon(
				row.createSpan({ cls: 'layer-field-type-icon' }),
				specFor(choice.type).icon,
			);
			const body = row.createSpan({ cls: 'layer-field-type-text' });
			body.createDiv({ cls: 'layer-field-type-label', text: choice.label });
			body.createDiv({ cls: 'layer-field-type-hint', text: choice.hint });
			// The pointer moves the cursor row rather than lighting one of its own,
			// so Enter chooses what is highlighted. Only classes are toggled.
			row.addEventListener('mousemove', () => this.setActive(index));
			row.addEventListener('mousedown', (event) => {
				event.preventDefault();
				this.choose(choice);
			});
		});
		this.paintActive();
		this.scrollActiveIntoView();
	}

	/** Moves the cursor to a row without rebuilding the list. */
	private setActive(index: number): void {
		if (this.active === index) {
			return;
		}
		this.active = index;
		this.paintActive();
		this.scrollActiveIntoView();
	}

	private paintActive(): void {
		Array.from(this.listEl.children).forEach((row, index) => {
			row.toggleClass('is-active', index === this.active);
		});
	}

	private scrollActiveIntoView(): void {
		this.listEl.children[this.active]?.scrollIntoView({ block: 'nearest' });
	}

	private onKey(event: KeyboardEvent): void {
		if (event.key === 'Escape') {
			event.preventDefault();
			this.close();
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			const choice = this.filtered[this.active];
			if (choice) {
				this.choose(choice);
			}
			return;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (this.filtered.length === 0) {
				return;
			}
			const step = event.key === 'ArrowDown' ? 1 : -1;
			const count = this.filtered.length;
			this.setActive((this.active + step + count) % count);
		}
	}

	private choose(choice: FieldTypeChoice): void {
		this.onPick(choice.type);
		this.close();
	}

	/** Whether the list is currently on screen. */
	isOpen(): boolean {
		return this.el.isConnected;
	}

	close(): void {
		document.removeEventListener('mousedown', this.onOutsideClick);
		window.removeEventListener('blur', this.onWindowBlur);
		this.el.remove();
	}
}
