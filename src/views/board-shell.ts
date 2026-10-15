import { Menu, setIcon } from 'obsidian';
import { t } from '../i18n';
import type { View } from '../types';

export interface ShellHandlers {
	onAddRecord(): void;
	onAddRecordAtTop(): void;
	onSelectView(viewId: string): void;
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

	renderToolbar(): HTMLElement {
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

		return bar;
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
