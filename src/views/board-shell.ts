import { Menu, setIcon, setTooltip } from 'obsidian';
import { t } from '../i18n';
import type { View } from '../types';

export interface ShellHandlers {
	onAddRecord(): void;
	/** Opens whatever chooses this view's columns. */
	onOpenViewFields(anchor: HTMLElement): void;
	onAddRecordAtTop(): void;
	onSelectView(viewId: string): void;
	/** Adds a board view to this table. */
	onAddView(): void;
	/** Renames a view. */
	onRenameView(viewId: string, name: string): void;
	/** Whether this view may be removed, which the table may not. */
	canDeleteView(viewId: string): boolean;
	/** Removes a view. */
	onDeleteView(viewId: string): void;
	/** Writes the table out as CSV beside the board. */
	onExportCsv(): void;
	/** Opens the sort rules panel, anchored to the button that asked for it. */
	onOpenSort(anchor: HTMLElement): void;
	/** Opens the filter rules panel, anchored to the button that asked for it. */
	onOpenFilter(anchor: HTMLElement): void;
	/** Whether there is a step to take back. */
	canUndo(): boolean;
	/** Whether there is a step to take forward. */
	canRedo(): boolean;
	/** Takes one edit back. */
	onUndo(): void;
	/** Puts back what was taken back. */
	onRedo(): void;
}

/** What the toolbar says about the current order, if there is one. */
export interface SortState {
	/** The column names in the order the rules apply; empty when unsorted. */
	columns: readonly string[];
	/** Whether the first rule runs descending, for the arrow on the button. */
	descending: boolean;
}

export interface ToolbarState {
	sort: SortState;
	/** How many conditions are active, for the filter button's badge. */
	filterCount: number;
}

export interface TabsState {
	views: View[];
	activeViewId: string;
}

export interface StatusState {
	/** Rows the view shows, after filtering. */
	recordCount: number;
	/** Rows the table holds, which differs once a filter is on. */
	totalRecordCount: number;
	columnCount: number | null;
	selectionLabel: string;
}

export class BoardShell {
	constructor(
		private readonly host: HTMLElement,
		private readonly handlers: ShellHandlers,
	) {}

	renderToolbar(state: ToolbarState): HTMLElement {
		const bar = this.host.createDiv({ cls: 'layer-shell-toolbar' });

		// A split control: the label does the common thing, the arrow offers the
		// rest. Two buttons rather than one that opens a menu, because appending a
		// row is the action wanted nearly every time.
		const split = bar.createDiv({ cls: 'layer-shell-split' });

		const add = split.createEl('button', {
			cls: 'layer-shell-button is-primary',
		});
		setIcon(add.createSpan({ cls: 'layer-shell-button-icon' }), 'plus');
		add.createSpan({ text: t().addRecord });
		add.addEventListener('click', (event) => {
			event.preventDefault();
			this.handlers.onAddRecord();
		});

		const more = split.createEl('button', {
			cls: 'layer-shell-button is-primary',
		});
		more.setAttribute('aria-label', t().addRecordMenu);
		setIcon(more.createSpan({ cls: 'layer-shell-button-icon' }), 'chevron-down');
		more.addEventListener('click', (event) => {
			event.preventDefault();
			this.showAddRecordMenu(more);
		});

		/*
		 * The button keeps one name. What it is sorting is shown beside it rather
		 * than in place of the name: a button whose label turns into a column name
		 * stops reading as an action and starts looking like a value.
		 */
		/*
		 * What this view shows, beside the button that adds a row: one place for the
		 * shape of the view, whichever kind it is. In a table it chooses which columns
		 * are visible, on a board which column groups and what a card carries.
		 */
		const fieldsButton = bar.createEl('button', { cls: 'layer-shell-button' });
		setIcon(
			fieldsButton.createSpan({ cls: 'layer-shell-button-icon' }),
			'columns-3',
		);
		fieldsButton.createSpan({ text: t().viewFieldsButton });
		fieldsButton.setAttribute('aria-label', t().viewFieldsHint);
		fieldsButton.addEventListener('click', (event) => {
			event.preventDefault();
			this.handlers.onOpenViewFields(fieldsButton);
		});

		const sortButton = bar.createEl('button', { cls: 'layer-shell-button' });
		sortButton.toggleClass('is-active', state.sort.columns.length > 0);
		setIcon(
			sortButton.createSpan({ cls: 'layer-shell-button-icon' }),
			state.sort.columns.length === 0
				? 'arrow-up-down'
				: state.sort.descending
					? 'arrow-down'
					: 'arrow-up',
		);
		sortButton.createSpan({ text: t().sortButton });
		sortButton.setAttribute('aria-label', this.sortAriaLabel(state.sort));
		sortButton.addEventListener('click', (event) => {
			event.preventDefault();
			this.handlers.onOpenSort(sortButton);
		});

		// What the current order is, next to the button rather than inside it.
		const summary = this.sortSummary(state.sort);
		if (summary !== '') {
			bar.createSpan({ cls: 'layer-shell-sort-summary', text: summary });
		}

		// Filtering takes rows away, so it says how many conditions are doing that.
		const filterButton = bar.createEl('button', { cls: 'layer-shell-button' });
		filterButton.toggleClass('is-active', state.filterCount > 0);
		setIcon(
			filterButton.createSpan({ cls: 'layer-shell-button-icon' }),
			'filter',
		);
		filterButton.createSpan({
			text:
				state.filterCount === 0
					? t().filterButton
					: `${t().filterButton} ${state.filterCount}`,
		});
		filterButton.setAttribute('aria-label', t().filterButton);
		filterButton.addEventListener('click', (event) => {
			event.preventDefault();
			this.handlers.onOpenFilter(filterButton);
		});

		bar.createDiv({ cls: 'layer-shell-spacer' });
		const overflow = bar.createEl('button', { cls: 'layer-shell-button' });
		overflow.setAttribute('aria-label', t().boardMenu);
		setIcon(overflow.createSpan({ cls: 'layer-shell-button-icon' }), 'more-horizontal');
		overflow.addEventListener('click', (event) => {
			event.preventDefault();
			this.showBoardMenu(overflow);
		});

		return bar;
	}

	/**
	 * What the order is, shown beside the button.
	 *
	 * One column reads as its name; several read as the first name and a count,
	 * because a summary long enough to hold them all would crowd the toolbar — the
	 * panel is where the full list lives. Empty when nothing is sorted.
	 */
	private sortSummary(state: SortState): string {
		const [first, ...rest] = state.columns;
		if (first === undefined) {
			return '';
		}
		return rest.length === 0 ? first : `${first} +${rest.length}`;
	}

	/** The full order as one sentence, for the button's accessible name. */
	private sortAriaLabel(state: SortState): string {
		if (state.columns.length === 0) {
			return t().sortButton;
		}
		return `${t().sortButton}: ${state.columns.join(', ')}`;
	}

	private showBoardMenu(anchor: HTMLElement): void {
		const menu = new Menu();
		// Undo and redo are here as well as on the keys, so the feature can be found
		// without knowing the shortcut.
		menu.addItem((item) =>
			item
				.setTitle(t().undoEdit)
				.setIcon('undo-2')
				.setDisabled(!this.handlers.canUndo())
				.onClick(() => this.handlers.onUndo()),
		);
		menu.addItem((item) =>
			item
				.setTitle(t().redoEdit)
				.setIcon('redo-2')
				.setDisabled(!this.handlers.canRedo())
				.onClick(() => this.handlers.onRedo()),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(t().exportCsv)
				.setIcon('file-down')
				.onClick(() => this.handlers.onExportCsv()),
		);
		const box = anchor.getBoundingClientRect();
		// Below the button, aligned to its right edge so the menu stays on screen.
		menu.showAtPosition({ x: box.right, y: box.bottom });
	}

	private showAddRecordMenu(anchor: HTMLElement): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle(t().addRecordAtBottom)
				.setIcon('arrow-down')
				.onClick(() => this.handlers.onAddRecord()),
		);
		menu.addItem((item) =>
			item
				.setTitle(t().addRecordAtTop)
				.setIcon('arrow-up')
				.onClick(() => this.handlers.onAddRecordAtTop()),
		);
		// Below the arrow, aligned with its left edge.
		menu.showAtPosition({ x: anchor.getBoundingClientRect().left, y: anchor.getBoundingClientRect().bottom });
	}

	renderTabs(state: TabsState): HTMLElement {
		const tabs = this.host.createDiv({ cls: 'layer-shell-tabs' });
		for (const view of state.views) {
			const tab = tabs.createEl('button', { cls: 'layer-shell-tab' });
			if (view.id === state.activeViewId) {
				tab.addClass('is-active');
			}
			const icon = tab.createSpan({ cls: 'layer-shell-tab-icon' });
			setIcon(icon, view.type === 'kanban' ? 'columns' : 'table');
			const label = tab.createSpan({ cls: 'layer-shell-tab-name', text: view.name });
			tab.addEventListener('click', (event) => {
				event.preventDefault();
				this.handlers.onSelectView(view.id);
			});
			/*
			 * Renaming is reached from the context menu, not from a double press: the
			 * first press selects the view, which redraws the row, so the element the
			 * second press would land on is gone and `dblclick` never fires.
			 */
			tab.addEventListener('contextmenu', (event) => {
				event.preventDefault();
				this.showViewMenu(event, tab, label, view);
			});
			setTooltip(tab, t().viewMenuHint);
		}

		/*
		 * Adding a board sits at the end of the row it is added to. Only boards are
		 * offered: a second table would differ from the first only in its filter, and
		 * more than one place still assumes a single table.
		 */
		const add = tabs.createEl('button', { cls: 'layer-shell-tab-add' });
		setIcon(add.createSpan(), 'plus');
		add.setAttribute('aria-label', t().addBoardView);
		setTooltip(add, t().addBoardViewHint);
		add.addEventListener('click', (event) => {
			event.preventDefault();
			this.handlers.onAddView();
		});
		return tabs;
	}

	/**
	 * What a view's tab offers when pressed with the right button.
	 *
	 * A menu rather than a gesture, so every operation on a view has one place to
	 * live instead of a new gesture each time.
	 */
	private showViewMenu(
		event: MouseEvent,
		tab: HTMLElement,
		label: HTMLElement,
		view: View,
	): void {
		const menu = new Menu();
		menu.addItem((item) =>
			item
				.setTitle(view.name)
				.setIsLabel(true),
		);
		menu.addSeparator();
		menu.addItem((item) =>
			item
				.setTitle(t().renameView)
				.setIcon('pencil')
				.onClick(() => this.beginRename(tab, label, view)),
		);
		menu.addItem((item) =>
			item
				.setTitle(t().deleteView)
				.setIcon('trash')
				/*
				 * The table is the data's own view and cannot go; a board may. The rule
				 * lives in the model, so the menu only asks rather than deciding.
				 */
				.setDisabled(!this.handlers.canDeleteView(view.id))
				.onClick(() => this.handlers.onDeleteView(view.id)),
		);
		menu.showAtMouseEvent(event);
	}

	/**
	 * Turns a tab's label into an input, and back again.
	 *
	 * Renaming happens in place rather than in a dialog: the label is short, and a
	 * window for it would be heavier than the change. Enter or leaving the field
	 * keeps the new name, Escape puts the old one back.
	 */
	private beginRename(
		tab: HTMLElement,
		label: HTMLElement,
		view: View,
	): void {
		if (tab.querySelector('input') !== null) {
			return;
		}
		const input = tab.createEl('input', { cls: 'layer-shell-tab-input' });
		input.value = view.name;
		label.hide();
		input.focus();
		input.select();

		let settled = false;
		const finish = (keep: boolean): void => {
			if (settled) {
				return;
			}
			settled = true;
			const name = input.value.trim();
			input.remove();
			label.show();
			if (keep && name !== '' && name !== view.name) {
				this.handlers.onRenameView(view.id, name);
			} else {
				label.setText(view.name);
			}
		};

		input.addEventListener('keydown', (event) => {
			// Escape leaves it as it was; Enter keeps it. Both end the edit.
			if (event.key === 'Enter') {
				event.preventDefault();
				finish(true);
			} else if (event.key === 'Escape') {
				event.preventDefault();
				event.stopPropagation();
				finish(false);
			}
		});
		input.addEventListener('blur', () => finish(true));
		// A press inside the field is not a press on the tab.
		input.addEventListener('click', (event) => event.stopPropagation());
		input.addEventListener('dblclick', (event) => event.stopPropagation());
	}

	renderStatusBar(state: StatusState): HTMLElement {
		const bar = this.host.createDiv({ cls: 'layer-shell-status' });

		bar.createSpan({ cls: 'layer-shell-selection', text: state.selectionLabel });

		bar.createDiv({ cls: 'layer-shell-spacer' });
		// A filtered table says so: the visible count alone would read as lost rows.
		const shown =
			state.recordCount === state.totalRecordCount
				? String(state.recordCount)
				: `${state.recordCount} / ${state.totalRecordCount}`;
		bar.createSpan({
			cls: 'layer-shell-count',
			text:
				state.columnCount === null
					? shown
					: `${shown} × ${state.columnCount}`,
		});
		return bar;
	}
}
