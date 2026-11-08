import { Setting, setIcon, setTooltip } from 'obsidian';
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
 *
 * Holds no copy of the answer: every box is drawn from the view itself, so a change
 * made elsewhere — or refused, which the view records by not changing — is what the
 * reader sees the moment this redraws. A snapshot taken when the panel opened would
 * drift, and the boxes would then disagree with the table behind them about how
 * many columns are left.
 */
export class ColumnVisibilityPopover extends AnchoredPopover {
	constructor(private readonly config: ColumnVisibilityOptions) {
		super(config.app, config.anchor, VISIBILITY_WIDTH);
	}

	onOpen(): void {
		super.onOpen();
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('layer-visibility');

		new Setting(contentEl)
			.setName(t().viewFieldsButton)
			.setHeading()
			.settingEl.addClass('layer-visibility-title');
		contentEl.createDiv({
			cls: 'layer-visibility-heading',
			text: t().viewFieldsHint,
		});

		const list = contentEl.createDiv({ cls: 'layer-visibility-list' });
		const hidden = new Set(this.config.view.hiddenFieldIds);
		// The last visible column may not be hidden, so the boxes are disabled once
		// only one is left — a table with no columns has nothing to draw.
		const remaining = visibleCount(this.config.fields, this.config.view);

		for (const field of this.config.fields) {
			const row = list.createEl('label', { cls: 'layer-visibility-row' });
			const box = row.createEl('input', { type: 'checkbox' });
			box.checked = !hidden.has(field.id);
			const lastOne = !hidden.has(field.id) && remaining <= 1;
			box.disabled = lastOne;
			if (lastOne) {
				setTooltip(row, t().viewFieldsLastColumn);
			}

			box.addEventListener('change', () => {
				this.config.onToggle(field.id, !box.checked);
				// The disabling of the other boxes depends on this one, and the answer
				// to what was asked comes from the view, not from this checkbox.
				this.render();
			});

			const icon = row.createSpan({ cls: 'layer-visibility-icon' });
			setIcon(icon, specFor(field.type).icon);
			row.createSpan({ cls: 'layer-visibility-name', text: field.name });
		}

		this.position();
	}
}

