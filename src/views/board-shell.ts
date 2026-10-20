import { Menu, setIcon } from 'obsidian';
import { t } from '../i18n';
import type { View } from '../types';

export interface ShellHandlers {
	onAddRecord(): void;
	onAddRecordAtTop(): void;
	onSelectView(viewId: string): void;
	/** Writes the table out as CSV beside the board. */
	onExportCsv(): void;
	/** Opens the sort rules panel, anchored to the button that asked for it. */
	onOpenSort(anchor: HTMLElement): void;
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
}

export interface TabsState {
	views: View[];
	activeViewId: string;
}

export interface StatusState {
	recordCount: number;
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
			tab.createSpan({ text: view.name });
			tab.addEventListener('click', (event) => {
				event.preventDefault();
				this.handlers.onSelectView(view.id);
			});
		}
		return tabs;
	}

	renderStatusBar(state: StatusState): HTMLElement {
		const bar = this.host.createDiv({ cls: 'layer-shell-status' });

		bar.createSpan({ cls: 'layer-shell-selection', text: state.selectionLabel });

		bar.createDiv({ cls: 'layer-shell-spacer' });
		bar.createSpan({
			cls: 'layer-shell-count',
			text:
				state.columnCount === null
					? String(state.recordCount)
					: `${state.recordCount} × ${state.columnCount}`,
		});
		return bar;
	}
}
