import { Setting, setIcon } from 'obsidian';
import { t } from '../i18n';
import {
	rowHeightPresetOf,
	wrapsOf,
	type RowHeightPreset,
} from '../model/layout';
import type { GridView } from '../types';
import { AnchoredPopover, type Anchor } from './anchored-popover';

const PANEL_WIDTH = '16rem';

export interface RowHeightOptions {
	app: AnchoredPopover['app'];
	anchor: Anchor | null;
	view: GridView;
	/** Called when a height is chosen, which also brings any dragged row back. */
	onChoose: (preset: RowHeightPreset) => void;
	onToggleWrap: (wrap: boolean) => void;
}

/** The heights in the order they are offered, shortest first. */
const ORDER: readonly RowHeightPreset[] = ['compact', 'standard', 'comfortable'];

/**
 * How tall the rows are, and whether a cell may run onto more lines.
 *
 * Two controls rather than one list of five, because they answer different
 * questions: the height is chosen for the whole table, while wrapping changes
 * what fits inside it.
 */
export class RowHeightPopover extends AnchoredPopover {
	constructor(private readonly config: RowHeightOptions) {
		super(config.app, config.anchor, PANEL_WIDTH);
	}

	onOpen(): void {
		super.onOpen();
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('layer-row-height');

		new Setting(contentEl)
			.setName(t().rowHeightButton)
			.setHeading()
			.settingEl.addClass('layer-row-height-title');
		contentEl.createDiv({
			cls: 'layer-row-height-heading',
			text: t().rowHeightHint,
		});

		const list = contentEl.createDiv({ cls: 'layer-row-height-list' });
		const current = rowHeightPresetOf(this.config.view);
		for (const preset of ORDER) {
			const item = list.createEl('button', { cls: 'layer-row-height-option' });
			item.toggleClass('is-active', preset === current);
			item.createSpan({ cls: 'layer-row-height-name', text: labelOf(preset) });
			const mark = item.createSpan({ cls: 'layer-row-height-mark' });
			if (preset === current) {
				setIcon(mark, 'check');
			}
			item.addEventListener('click', (event) => {
				event.preventDefault();
				this.config.onChoose(preset);
				// Draw again so the tick moves with the choice, and so the height
				// list agrees after the rows it undid were redrawn.
				this.render();
			});
		}

		const wrapRow = contentEl.createEl('label', { cls: 'layer-row-height-wrap' });
		const box = wrapRow.createEl('input', { type: 'checkbox' });
		box.checked = wrapsOf(this.config.view);
		box.addEventListener('change', () => {
			this.config.onToggleWrap(box.checked);
		});
		wrapRow.createSpan({ text: t().autoWrap });

		this.position();
	}
}

function labelOf(preset: RowHeightPreset): string {
	switch (preset) {
		case 'compact':
			return t().rowHeightCompact;
		case 'comfortable':
			return t().rowHeightComfortable;
		default:
			return t().rowHeightStandard;
	}
}
