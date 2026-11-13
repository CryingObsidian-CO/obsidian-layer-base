import { setIcon } from 'obsidian';
import { generateId } from '../utils/id';
import { placeAtAnchor } from './anchor-placement';
import { renderOptionPill } from './option-pill';

export interface DropdownItem {
	key: string;
	label: string;
	hint?: string;
	icon?: string;
	pillColor?: string;
	modifier?: string;
}

/** What the core already put on the row, handed to a consumer's `renderRow`. */
export interface DropdownRowState {
	active: boolean;
	selected: boolean;
}

export interface SearchableDropdownConfig {
	anchor: HTMLElement;
	/** Inside a modal this must be a sibling of `.modal`, whose scrolling box would clip the list. */
	host?: HTMLElement;
	bodyClass: string;
	rowClass: string;
	placeholder: string;
	emptyText: string;
	items: (query: string) => readonly DropdownItem[];
	selectedKey?: () => string | null;
	selectedKeys?: () => readonly string[];
	renderRow?: (
		row: HTMLElement,
		item: DropdownItem,
		state: DropdownRowState,
	) => void;
	/** `'keep-open'` leaves the panel up, for a list that collects several choices. */
	onPick: (item: DropdownItem, query: string) => void | 'keep-open';
	/** The panel went away, however it went away. Called at most once. */
	onClose?: () => void;
}

/** An IME composition's Enter commits a candidate, so it is no command; `Process` is Chromium's key for one taken. */
function isComposing(event: KeyboardEvent): boolean {
	return event.isComposing || event.key === 'Process';
}

/** Geometry, listeners and keyboard; a row's meaning is the consumer's business, and focus never returns to the anchor. */
export class SearchableDropdown {
	readonly el: HTMLElement;

	private readonly config: SearchableDropdownConfig;
	private readonly inputEl: HTMLInputElement;
	private readonly listEl: HTMLElement;
	/** Unique per instance, so two dropdowns can never share row ids. */
	private readonly listId = generateId('layer-dropdown');
	private emptyEl: HTMLElement | null = null;
	private rows: readonly DropdownItem[] = [];
	private active = 0;
	private closed = false;
	/** Set by a mousedown, so the click of that same gesture is not a second pick. */
	private gestureTaken = false;

	constructor(config: SearchableDropdownConfig) {
		this.config = config;
		const host =
			config.host ?? config.anchor.closest('.modal-container') ?? document.body;
		this.el = host.createDiv({ cls: config.bodyClass });

		this.inputEl = this.el.createEl('input', {
			cls: `${config.bodyClass}-input`,
			type: 'text',
			placeholder: config.placeholder,
		});
		this.listEl = this.el.createDiv({ cls: `${config.bodyClass}-list` });

		// A listbox with no `option` rows is announced as an empty list, which is worse than
		// no ARIA at all; Obsidian's own listboxes pair the two roles, so this mirrors that.
		this.listEl.id = this.listId;
		this.listEl.setAttribute('role', 'listbox');
		this.inputEl.setAttribute('role', 'combobox');
		this.inputEl.setAttribute('aria-autocomplete', 'list');
		this.inputEl.setAttribute('aria-haspopup', 'listbox');
		this.inputEl.setAttribute('aria-controls', this.listId);

		// A click inside the panel is not a click on whatever opened it.
		this.el.addEventListener('mousedown', (event) => event.stopPropagation());
		this.inputEl.addEventListener('input', () => this.refresh());
		this.inputEl.addEventListener('keydown', (event) => this.onKey(event));

		this.refresh();

		// Displayed first: a hidden element measures as zero and would always be placed below.
		// Off-screen while measuring, so it cannot flash.
		this.el.addClass('is-measuring');
		window.setTimeout(() => {
			if (this.closed) {
				return;
			}
			const anchorRect = this.config.anchor.getBoundingClientRect();
			this.el.style.width = `${anchorRect.width}px`;
			placeAtAnchor(this.el, anchorRect, this.el.getBoundingClientRect());
			this.el.removeClass('is-measuring');
			this.el.addClass('is-open');
			this.inputEl.focus();
			// The caret belongs after whatever is already typed, so a query can be typed into.
			const end = this.inputEl.value.length;
			this.inputEl.setSelectionRange(end, end);
		}, 0);

		// Deferred, so the click that opened this does not immediately close it.
		window.setTimeout(() => {
			if (this.closed) {
				return;
			}
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

	refresh(): void {
		this.render(this.inputEl.value);
	}

	private selectedKeys(): readonly string[] {
		if (this.config.selectedKeys) {
			return this.config.selectedKeys();
		}
		const one = this.config.selectedKey?.() ?? null;
		return one === null ? [] : [one];
	}

	private render(query: string): void {
		const marked = this.selectedKeys();
		this.rows = [...this.config.items(query)];
		// Seated on a chosen row on every render, falling back to the top: a stray Enter then
		// re-picks what is already chosen instead of moving the value along.
		const found = this.rows.findIndex((item) => marked.includes(item.key));
		this.active = found < 0 ? 0 : found;

		this.listEl.empty();
		this.emptyEl?.remove();
		this.emptyEl = null;
		if (this.rows.length === 0) {
			// A sibling of the list, never a child: otherwise rows and this share one scrolling box.
			this.emptyEl = this.el.createDiv({
				cls: `${this.config.bodyClass}-empty`,
				text: this.config.emptyText,
			});
			// Still repainted: the list was just emptied, so this clears `aria-activedescendant`.
			this.paintActive();
			return;
		}
		this.rows.forEach((item, index) => this.appendRow(item, index));
		this.paintActive();
		this.scrollActiveIntoView();
	}

	private appendRow(item: DropdownItem, index: number): void {
		const row = this.listEl.createDiv({ cls: this.config.rowClass });
		if (item.modifier) {
			row.addClass(item.modifier);
		}
		const selected = this.selectedKeys().includes(item.key);
		if (selected) {
			row.addClass('is-selected');
		}
		// `aria-selected` is the CURRENT VALUE, not the highlight: the cursor row is carried by
		// `aria-activedescendant`, so the two never contradict each other.
		row.id = `${this.listId}-${index}`;
		row.setAttribute('role', 'option');
		row.setAttribute('aria-selected', String(selected));
		if (this.config.renderRow) {
			this.config.renderRow(row, item, { active: index === this.active, selected });
		} else {
			this.drawRow(row, item);
		}
		// The pointer moves the cursor row, so Enter chooses what is highlighted; only classes toggle.
		row.addEventListener('mousemove', () => this.setActive(index));
		row.addEventListener('mousedown', (event) => {
			// Keeps the caret in the search box instead of moving it to the row.
			event.preventDefault();
			// The gesture is taken on mousedown and the click belonging to it is dropped: a
			// pick may rebuild the rows, so that click can land on one that shifted under it.
			this.gestureTaken = true;
			this.pick(item);
		});
		row.addEventListener('click', () => {
			if (this.gestureTaken) {
				this.gestureTaken = false;
				return;
			}
			this.pick(item);
		});
	}

	/** The row a consumer gets when it does not draw its own. */
	private drawRow(row: HTMLElement, item: DropdownItem): void {
		// Drawn even when empty: a fixed-width gutter, so rows with and without an icon line up.
		const slot = row.createSpan({ cls: `${this.config.bodyClass}-row-icon` });
		if (item.icon) {
			setIcon(slot, item.icon);
		}
		const label = row.createSpan({ cls: `${this.config.bodyClass}-row-label` });
		if (item.pillColor !== undefined) {
			renderOptionPill(label, item.label, item.pillColor);
		} else {
			label.setText(item.label);
		}
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
		const active = this.listEl.children[this.active];
		Array.from(this.listEl.children).forEach((row, index) => {
			row.toggleClass('is-active', index === this.active);
		});
		// Cleared, never left naming a row that is gone: the attribute must not point at an
		// absent id, so an empty list publishes no active row.
		if (active instanceof HTMLElement) {
			this.inputEl.setAttribute('aria-activedescendant', active.id);
		} else {
			this.inputEl.removeAttribute('aria-activedescendant');
		}
	}

	private scrollActiveIntoView(): void {
		this.listEl.children[this.active]?.scrollIntoView({ block: 'nearest' });
	}

	private onKey(event: KeyboardEvent): void {
		if (isComposing(event)) {
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			this.close();
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			const item = this.rows[this.active];
			if (item) {
				this.pick(item);
			}
			return;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			const count = this.rows.length;
			if (count === 0) {
				return;
			}
			const step = event.key === 'ArrowDown' ? 1 : -1;
			this.setActive((this.active + step + count) % count);
		}
	}

	/** Reports the pick, then closes unless the consumer asks to keep the panel up. */
	private pick(item: DropdownItem): void {
		if (this.closed) {
			return;
		}
		const keep = this.config.onPick(item, this.inputEl.value) === 'keep-open';
		if (keep) {
			// The chosen set just changed, so the rows are rebuilt; the box is cleared so the
			// next press starts from the whole list.
			this.inputEl.value = '';
			this.refresh();
			this.inputEl.focus();
			return;
		}
		this.close();
	}

	isOpen(): boolean {
		return this.el.isConnected;
	}

	/** Listeners first, then the element, then the consumer told once. */
	close(): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		document.removeEventListener('mousedown', this.onOutsideClick);
		window.removeEventListener('blur', this.onWindowBlur);
		this.el.remove();
		this.config.onClose?.();
	}
}
