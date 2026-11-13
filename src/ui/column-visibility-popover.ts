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
	/** Fires per box, not on close, so the table answers immediately. */
	onToggle: (fieldId: string, hidden: boolean) => void;
}

/** Drawn from the view each time: a snapshot would drift and disagree with the table behind. */
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
		// The last visible column cannot be hidden: a table with no columns has nothing to draw.
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
				// Redraw from the view: which other boxes are disabled depends on this one.
				this.render();
			});

			const icon = row.createSpan({ cls: 'layer-visibility-icon' });
			setIcon(icon, specFor(field.type).icon);
			row.createSpan({ cls: 'layer-visibility-name', text: field.name });
		}

		this.position();
	}
}

