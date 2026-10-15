import { setIcon } from 'obsidian';
import { t } from '../i18n';
import type { View } from '../types';

/**
 * The chrome around a board.
 *
 * Three bands, top to bottom:
 *
 * 1. **Action row** — operations on the data itself (adding a row).
 * 2. **View tabs** — switches which view is rendered over that data.
 * 3. **Status row** — a read-out of what is on screen.
 *
 * The split is by scope rather than by convention: the action row changes the
 * data, the tab row changes the projection of it, and the status row changes
 * nothing. Keeping them in that order means the band a control lives in tells
 * you what it affects.
 *
 * Only actions that exist are rendered. Buttons for filtering, sorting and
 * grouping arrive with those features rather than sitting disabled, which would
 * promise something the plugin cannot yet do.
 */

export interface ShellHandlers {
	/** Append a blank record. */
	onAddRecord(): void;
	/** Switch the rendered view. */
	onSelectView(viewId: string): void;
}

export interface TabsState {
	views: View[];
	activeViewId: string;
}

export interface StatusState {
	recordCount: number;
	/** Column count, or null when the active view has no columns. */
	columnCount: number | null;
	/** What is selected, or an empty string when nothing is. */
	selectionLabel: string;
}

export class BoardShell {
	constructor(
		private readonly host: HTMLElement,
		private readonly handlers: ShellHandlers,
	) {}

	/** Action row: operations that change the data. */
	renderToolbar(): HTMLElement {
		const bar = this.host.createDiv({ cls: 'layer-shell-toolbar' });

		const add = bar.createEl('button', {
			cls: 'layer-shell-button is-primary',
		});
		setIcon(add.createSpan({ cls: 'layer-shell-button-icon' }), 'plus');
		add.createSpan({ text: t().addRecord });
		add.addEventListener('click', (event) => {
			event.preventDefault();
			this.handlers.onAddRecord();
		});

		return bar;
	}

	/** View tabs: switches the projection over the same data. */
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

	/** Status row: read-only summary. */
	renderStatusBar(state: StatusState): HTMLElement {
		const bar = this.host.createDiv({ cls: 'layer-shell-status' });

		// Carries its own class so a selection change can repaint this text
		// without rebuilding the row or the grid behind it.
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
