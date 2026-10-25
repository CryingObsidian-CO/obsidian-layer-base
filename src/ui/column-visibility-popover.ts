import { setIcon, setTooltip } from 'obsidian';
import { t } from '../i18n';
import type { Field, View } from '../types';
import { specFor } from '../model/fields';
import { visibleCount } from '../model/visibility';
import { AnchoredPopover, type Anchor } from './anchored-popover';

const VISIBILITY_WIDTH = '18rem';

export interface ColumnVisibilityOptions {
	app: AnchoredPopover['app'];
	anchor: Anchor | null;
	view: View;
	fields: readonly Field[];
	/** Called as each box is ticked, so the table answers immediately. */
	onToggle: (fieldId: string, hidden: boolean) => void;
}

/**
 * Which columns a view shows.
 *
 * The same button that opens the board's own column settings opens this in a table:
 * one place for "what this view shows", whichever view is in front of the reader.
 */
export class ColumnVisibilityPopover extends AnchoredPopover {
	private hidden: Set<string>;

	constructor(private readonly config: ColumnVisibilityOptions) {
		super(config.app, config.anchor, VISIBILITY_WIDTH);
		this.hidden = new Set(config.view.hiddenFieldIds);
	}

	onOpen(): void {
		super.onOpen();
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('layer-visibility');

		contentEl.createEl('h2', {
			cls: 'layer-visibility-title',
			text: t().viewFieldsButton,
		});
		contentEl.createDiv({
			cls: 'layer-visibility-heading',
			text: t().viewFieldsHint,
		});

		const list = contentEl.createDiv({ cls: 'layer-visibility-list' });
		// The last visible column may not be hidden, so the boxes are disabled once
		// only one is left — a table with no columns has nothing to draw.
		const remaining = visibleCount(this.config.fields, {
			...this.config.view,
			hiddenFieldIds: [...this.hidden],
		});

		for (const field of this.config.fields) {
			const row = list.createEl('label', { cls: 'layer-visibility-row' });
			const box = row.createEl('input', { type: 'checkbox' });
			box.checked = !this.hidden.has(field.id);
			const lastOne = !this.hidden.has(field.id) && remaining <= 1;
			box.disabled = lastOne;
			if (lastOne) {
				setTooltip(row, t().viewFieldsLastColumn);
			}

			box.addEventListener('change', () => {
				const hidden = !box.checked;
				if (hidden) {
					this.hidden.add(field.id);
				} else {
					this.hidden.delete(field.id);
				}
				this.config.onToggle(field.id, hidden);
				// The disabling of the other boxes depends on this one.
				this.render();
			});

			const icon = row.createSpan({ cls: 'layer-visibility-icon' });
			setIcon(icon, specFor(field.type).icon);
			row.createSpan({ cls: 'layer-visibility-name', text: field.name });
		}

		this.position();
	}
}

