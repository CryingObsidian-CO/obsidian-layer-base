import { setIcon } from 'obsidian';
import { generateId } from '../utils/id';
import { placeAtAnchor } from './anchor-placement';
import { renderOptionPill } from './option-pill';

/** One row of the list: what it shows, and the key that tells two rows apart. */
export interface DropdownItem {
	key: string;
	label: string;
	hint?: string;
	icon?: string;
	pillColor?: string;
	modifier?: string;
}

/**
 * The state the core owns and puts on the row element. A consumer that draws
 * its own row is told about it, so it never has to re-derive it from the key.
 */
export interface DropdownRowState {
	active: boolean;
	selected: boolean;
}

/** Everything a consumer hands over for the core to run a dropdown. */
export interface SearchableDropdownConfig {
	/** The element the panel hangs off; its width and position are borrowed. */
	anchor: HTMLElement;
	/**
	 * Where the panel is parented. Inside a modal this has to be a sibling of
	 * `.modal`, whose scrolling box would otherwise clip the list.
	 */
	host?: HTMLElement;
	/** Container class; the input, list, empty element and icon slot derive from it. */
	bodyClass: string;
	rowClass: string;
	placeholder: string;
	/** Shown instead of the rows when `items()` returns nothing. */
	emptyText: string;
	/** The rows for a query. Filtering is the consumer's own business. */
	items: (query: string) => readonly DropdownItem[];
	/** The key of the row the cursor starts on; the top row when it is gone. */
	selectedKey?: () => string | null;
	/** Draws a row's contents; without it the core draws the icon slot plus the label. */
	renderRow?: (
		row: HTMLElement,
		item: DropdownItem,
		state: DropdownRowState,
	) => void;
	/** A row was chosen. The query comes along, for consumers that create. */
	onPick: (item: DropdownItem, query: string) => void;
	/** The panel went away, however it went away. Called at most once. */
	onClose?: () => void;
}

/**
 * A key that only ends an IME composition is not a command: the user is still
 * typing Chinese, and the Enter that commits a candidate must neither pick a
 * row nor close the list.
 */
function isComposing(event: KeyboardEvent): boolean {
	return event.isComposing || event.key === 'Process' || event.keyCode === 229;
}

/**
 * The mechanics behind every dropdown in the plugin: a search box over a list
 * of rows, anchored under whatever opened it.
 *
 * The core owns the geometry, the listeners and the keyboard, and knows nothing
 * about what a row means. A consumer supplies `items()` — its own filtering
 * included — and optionally `renderRow()`, and is told about a pick or a close.
 * The core never moves the focus back to the anchor: a close caused by a click
 * elsewhere has to leave the focus where that click put it.
 */
export class SearchableDropdown {
	/** The panel, already parented: hidden until it has been measured. */
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

		/*
		 * The listbox pattern, completed rather than half-declared. A list with
		 * `role="listbox"` and no `role="option"` rows is announced as an EMPTY
		 * list, which is worse than declaring no ARIA at all: it promises a
		 * structure that is not there. Obsidian's own listboxes pair the two
		 * roles and name the active row, so this mirrors that.
		 */
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

		// Displayed first: a hidden element measures as zero and would always be
		// placed below. Off-screen while measuring, so it cannot flash.
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
			// The caret belongs after whatever is already typed, so a list that
			// opens with a query can be typed into rather than typed over.
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

	/** Re-reads the items and repaints, for a consumer whose data has changed. */
	refresh(): void {
		this.render(this.inputEl.value);
	}

	private render(query: string): void {
		const selected = this.config.selectedKey?.() ?? null;
		this.rows = [...this.config.items(query)];
		// The cursor is seated on the current choice on every render, including
		// when the query changed: with the choice filtered out, or with none set
		// at all, that falls back to the top row. A stray Enter then re-picks
		// what is already chosen instead of moving the value along.
		const found = this.rows.findIndex((item) => item.key === selected);
		this.active = found < 0 ? 0 : found;

		this.listEl.empty();
		this.emptyEl?.remove();
		this.emptyEl = null;
		if (this.rows.length === 0) {
			// A sibling of the list rather than a child, so rows and this never
			// share a scrolling box. It is left out entirely while rows exist,
			// since it would otherwise still take up its own padding.
			this.emptyEl = this.el.createDiv({
				cls: `${this.config.bodyClass}-empty`,
				text: this.config.emptyText,
			});
			// Still repainted: the list was just emptied, so this is what clears
			// `aria-activedescendant` instead of letting it name a row that is gone.
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
		const selected = item.key === (this.config.selectedKey?.() ?? null);
		if (selected) {
			row.addClass('is-selected');
		}
		/*
		 * `aria-selected` reports whether this row is the CURRENT VALUE, not
		 * whether it is merely highlighted: the cursor row is carried by
		 * `aria-activedescendant` instead, so the two never contradict each other.
		 */
		row.id = `${this.listId}-${index}`;
		row.setAttribute('role', 'option');
		row.setAttribute('aria-selected', String(selected));
		if (this.config.renderRow) {
			this.config.renderRow(row, item, { active: index === this.active, selected });
		} else {
			this.drawRow(row, item);
		}
		// The pointer moves the cursor row rather than lighting one of its own,
		// so Enter chooses what is highlighted. Only classes are toggled.
		row.addEventListener('mousemove', () => this.setActive(index));
		row.addEventListener('mousedown', (event) => {
			// Keeps the caret in the search box instead of moving it to the row.
			event.preventDefault();
			this.pick(item);
		});
		row.addEventListener('click', () => this.pick(item));
	}

	/** The row a consumer gets when it does not draw its own. */
	private drawRow(row: HTMLElement, item: DropdownItem): void {
		// The icon slot is drawn even when it stays empty: it is a fixed-width
		// gutter, so a row with no icon still lines up with the rows that have one.
		const slot = row.createSpan({ cls: `${this.config.bodyClass}-row-icon` });
		if (item.icon) {
			setIcon(slot, item.icon);
		}
		// `hint` is for consumers that draw their own row; the shared row is the
		// icon slot and the label, nothing else.
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
		/*
		 * Cleared rather than left pointing at a row that no longer exists: the
		 * attribute must never name an id that is absent from the document, so an
		 * empty list publishes no active row at all.
		 */
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

	/**
	 * Reports the pick, then closes. One gesture can deliver both a mousedown and
	 * a click to a row, so the second of the two finds the panel already closed.
	 */
	private pick(item: DropdownItem): void {
		if (this.closed) {
			return;
		}
		this.config.onPick(item, this.inputEl.value);
		this.close();
	}

	/** Whether the panel is currently on screen. */
	isOpen(): boolean {
		return this.el.isConnected;
	}

	/**
	 * Takes the panel down: the listeners go first, then the element, then the
	 * consumer is told once. Calling it again does nothing.
	 */
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
