import { Setting, setIcon } from 'obsidian';
import { t } from '../i18n';
import type { Field, KanbanView } from '../types';
import { specFor } from '../model/fields';
import { AnchoredPopover, type Anchor } from './anchored-popover';

const BOARD_FIELDS_WIDTH = '20rem';

export interface BoardFieldsOptions {
	app: AnchoredPopover['app'];
	anchor: Anchor | null;
	view: KanbanView;
	fields: readonly Field[];
	primaryFieldId: string;
	onSubmit: (result: BoardFieldsResult) => void;
}

export interface BoardFieldsResult {
	groupByFieldId: string;
	/** `''` when the table's primary column should title the cards. */
	titleFieldId: string;
	cardFieldIds: string[];
}

/** Only choices about the board; nothing here edits a column. */
export class BoardFieldsPopover extends AnchoredPopover {
	private groupByFieldId: string;
	private titleFieldId: string;
	private cardFieldIds: string[];

	constructor(private readonly config: BoardFieldsOptions) {
		super(config.app, config.anchor, BOARD_FIELDS_WIDTH);
		this.groupByFieldId = config.view.groupByFieldId;
		this.titleFieldId = config.view.titleFieldId ?? '';
		this.cardFieldIds = [...config.view.cardFieldIds];
	}

	onOpen(): void {
		super.onOpen();
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('layer-board-fields');

		new Setting(contentEl)
			.setName(t().boardFieldsTitle)
			.setHeading()
			.settingEl.addClass('layer-board-fields-title');

		this.groupByFieldId = this.renderChoice(
			contentEl,
			t().boardFieldsGroupBy,
			this.groupByFieldId,
			(fieldId) => {
				this.groupByFieldId = fieldId;
				// The note about the grouping column has to follow the choice.
				this.render();
			},
		);

		// The title may stay unset, which is what a board never configured already does.
		this.titleFieldId = this.renderChoice(
			contentEl,
			t().boardFieldsTitleField,
			this.titleFieldId,
			(fieldId) => {
				this.titleFieldId = fieldId;
			},
			t().boardFieldsTitleFallback,
		);

		this.renderCardFields(contentEl);

		const actions = contentEl.createDiv({ cls: 'layer-board-fields-actions' });
		const cancel = actions.createEl('button', { text: t().cancel });
		cancel.addEventListener('click', () => this.close());
		const save = actions.createEl('button', {
			cls: 'mod-cta',
			text: t().save,
		});
		save.addEventListener('click', () => this.submit());

		this.position();
	}

	/**
	 * Answers the value the select settled on, which is not always the one asked for: a
	 * column that is gone has no option, and the draft would keep an id nobody chose.
	 */
	private renderChoice(
		host: HTMLElement,
		label: string,
		value: string,
		onChange: (fieldId: string) => void,
		fallback?: string,
	): string {
		const grid = host.createDiv({ cls: 'layer-field-grid' });
		grid.createDiv({ cls: 'layer-field-label', text: label });
		const select = grid.createEl('select', {
			cls: 'layer-field-number-format',
		});
		if (fallback !== undefined) {
			const none = select.createEl('option', { text: fallback });
			none.value = '';
		}
		for (const field of this.config.fields) {
			const option = select.createEl('option', { text: field.name });
			option.value = field.id;
		}
		const known = this.config.fields.some((field) => field.id === value);
		const settled = known ? value : (select.options[0]?.value ?? '');
		select.value = settled;
		select.addEventListener('change', () => onChange(select.value));
		return settled;
	}

	/** The order is the table's, not the order they were ticked: a card would otherwise rearrange itself. */
	private renderCardFields(host: HTMLElement): void {
		host.createDiv({
			cls: 'layer-board-fields-heading',
			text: t().boardFieldsOnCard,
		});
		// Scrolled rather than grown: twenty columns would push the panel past the window.
		const list = host.createDiv({ cls: 'layer-board-fields-list' });

		for (const field of this.config.fields) {
			const row = list.createEl('label', { cls: 'layer-board-fields-row' });
			const box = row.createEl('input', { type: 'checkbox' });
			box.checked = this.cardFieldIds.includes(field.id);
			box.addEventListener('change', () => {
				this.cardFieldIds = box.checked
					? [...this.cardFieldIds, field.id]
					: this.cardFieldIds.filter((id) => id !== field.id);
			});

			const icon = row.createSpan({ cls: 'layer-board-fields-icon' });
			setIcon(icon, specFor(field.type).icon);
			row.createSpan({ cls: 'layer-board-fields-name', text: field.name });
			if (field.id === this.groupByFieldId) {
				row.addClass('is-grouping');
				row.createSpan({
					cls: 'layer-board-fields-note',
					text: t().boardFieldsGroupingNote,
				});
			}
		}
	}

	private submit(): void {
		this.config.onSubmit({
			groupByFieldId: this.groupByFieldId,
			titleFieldId: this.titleFieldId,
			cardFieldIds: this.cardFieldIds,
		});
		this.close();
	}
}
