import { setIcon } from 'obsidian';
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
	/** The column a card falls back to when none was chosen. */
	primaryFieldId: string;
	onSubmit: (result: BoardFieldsResult) => void;
}

/** What the panel reports back: everything it lets the reader change. */
export interface BoardFieldsResult {
	groupByFieldId: string;
	/** `''` when the table's primary column should title the cards. */
	titleFieldId: string;
	cardFieldIds: string[];
}

/**
 * The columns a board uses, in a panel beside the button that opened it.
 *
 * Kept apart from the table's field editor because these are choices about the
 * board, not about the columns themselves: which one groups, which one titles a
 * card, and which ones show on it. Nothing here changes a column.
 */
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

		contentEl.createEl('h2', {
			cls: 'layer-board-fields-title',
			text: t().boardFieldsTitle,
		});

		this.renderChoice(
			contentEl,
			t().boardFieldsGroupBy,
			this.groupByFieldId,
			(fieldId) => {
				this.groupByFieldId = fieldId;
				// The note about the grouping column has to follow the choice.
				this.render();
			},
		);

		// The title may be left to the table's primary column, which is what a board
		// that was never configured already does.
		this.renderChoice(
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

	/** One labelled dropdown over the table's columns. */
	private renderChoice(
		host: HTMLElement,
		label: string,
		value: string,
		onChange: (fieldId: string) => void,
		fallback?: string,
	): void {
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
		select.value = value;
		select.addEventListener('change', () => onChange(select.value));
	}

	/**
	 * The columns a card shows, as a tick list.
	 *
	 * The order is the table's, not the order they were ticked: a card that
	 * rearranged itself as fields were added would be hard to read.
	 */
	private renderCardFields(host: HTMLElement): void {
		host.createDiv({
			cls: 'layer-board-fields-heading',
			text: t().boardFieldsOnCard,
		});
		// Scrolled rather than grown: a table of twenty columns would otherwise push
		// the panel past the bottom of the window.
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
				// The grouping column is already the board's structure; repeating it
				// on every card says nothing the column does not.
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
