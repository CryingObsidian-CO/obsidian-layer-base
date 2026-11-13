import { Menu, setIcon, setTooltip } from 'obsidian';
import { t } from '../i18n';
import type { View } from '../types';

export interface ShellHandlers {
	onAddRecord(): void;
	onOpenViewFields(anchor: HTMLElement): void;
	onAddRecordAtTop(): void;
	onSelectView(viewId: string): void;
	onAddView(): void;
	onRenameView(viewId: string, name: string): void;
	/** The table view is the data's own and cannot be removed; a board can. */
	canDeleteView(viewId: string): boolean;
	onDeleteView(viewId: string): void;
	onExportCsv(): void;
	onOpenSort(anchor: HTMLElement): void;
	onOpenRowHeight(anchor: HTMLElement): void;
	onOpenColorRules(anchor: HTMLElement): void;
	onOpenFilter(anchor: HTMLElement): void;
	canUndo(): boolean;
	canRedo(): boolean;
	onUndo(): void;
	onRedo(): void;
}

export interface SortState {
	/** Column names in the order the rules apply; empty when unsorted. */
	columns: readonly string[];
	/** Whether the first rule runs descending. */
	descending: boolean;
}

export interface ToolbarState {
	sort: SortState;
	/** Active conditions, for the filter button's badge. */
	filterCount: number;
	/** Whether this view draws rows, and so has a height and colours to choose. */
	isGrid: boolean;
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

		// Split control: the label appends, the arrow offers top and bottom.
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

		// A board's rows have no height or colour of their own, so it gets neither button.
		if (state.isGrid) {
			const heightButton = bar.createEl('button', { cls: 'layer-shell-button' });
			setIcon(
				heightButton.createSpan({ cls: 'layer-shell-button-icon' }),
				'rows-3',
			);
			heightButton.createSpan({ text: t().rowHeightButton });
			heightButton.setAttribute('aria-label', t().rowHeightHint);
			heightButton.addEventListener('click', (event) => {
				event.preventDefault();
				this.handlers.onOpenRowHeight(heightButton);
			});

			const colorButton = bar.createEl('button', { cls: 'layer-shell-button' });
			setIcon(
				colorButton.createSpan({ cls: 'layer-shell-button-icon' }),
				'palette',
			);
			colorButton.createSpan({ text: t().colorRulesButton });
			colorButton.setAttribute('aria-label', t().colorRulesButton);
			colorButton.addEventListener('click', (event) => {
				event.preventDefault();
				this.handlers.onOpenColorRules(colorButton);
			});
		}

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

	/** One name, or the first name and a count; the panel holds the full list. */
	private sortSummary(state: SortState): string {
		const [first, ...rest] = state.columns;
		if (first === undefined) {
			return '';
		}
		return rest.length === 0 ? first : `${first} +${rest.length}`;
	}

	private sortAriaLabel(state: SortState): string {
		if (state.columns.length === 0) {
			return t().sortButton;
		}
		return `${t().sortButton}: ${state.columns.join(', ')}`;
	}

	private showBoardMenu(anchor: HTMLElement): void {
		const menu = new Menu();
		// Also on the keys, but here so it can be found without knowing them.
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
		// A position names the menu's own top-left corner, so align to the button's left edge.
		menu.showAtPosition({ x: box.left, y: box.bottom });
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
		const box = anchor.getBoundingClientRect();
		menu.showAtPosition({ x: box.left, y: box.bottom });
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
			// Rename is on the context menu: a first press selects the view and redraws
			// the tab, so `dblclick` never fires on the element the second press lands on.
			tab.addEventListener('contextmenu', (event) => {
				event.preventDefault();
				this.showViewMenu(event, tab, label, view);
			});
			setTooltip(tab, t().viewMenuHint);
		}

		// Only boards: more than one place still assumes a single table.
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
				// The table is the data's own view and cannot go; the model decides, so this asks.
				.setDisabled(!this.handlers.canDeleteView(view.id))
				.onClick(() => this.handlers.onDeleteView(view.id)),
		);
		menu.showAtMouseEvent(event);
	}

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
			// Escape keeps the old name, Enter the new one; either ends the edit.
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
