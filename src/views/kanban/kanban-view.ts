import { Menu, setIcon, setTooltip } from 'obsidian';
import { t } from '../../i18n';
import type { Field, KanbanView, LayerDoc, LayerRecord } from '../../types';
import type { CardColumns } from '../../model/kanban';
import {
	cardColumnsFor,
	columnLimitOf,
	groupRecords,
	valueForColumn,
	type KanbanColumn,
} from '../../model/kanban';
import { filterRecords } from '../../model/filter';
import { specFor } from '../../model/fields';
import { sortRecords } from '../../model/sort';

export interface KanbanHandlers {
	/** Switches this board to group by another column. */
	onSetGroupField(fieldId: string): void;
	/** Stores a new column limit on this board. */
	onSetColumnLimit(limit: number): void;
	/** Stores whether the board shows columns no row uses yet. */
	onSetShowEmpty(show: boolean): void;
	/** Writes a new value into the grouping column, moving the card. */
	onMove(index: { recordId: string; column: KanbanColumn }): void;
	/** Opens a card, which means opening its row in the table. */
	onOpenRecord(recordId: string): void;
	/** What a cell reads as, for grouping and for card titles. */
	displayText(field: Field, record: LayerRecord): string;
}

/**
 * The board: one column per value of the grouping column, one card per row.
 *
 * Rows are grouped by the text the column shows, so a board of dates reads as a
 * calendar and a board of a multiple-value column keeps each distinct selection
 * together rather than scattering its rows across columns.
 */
export class KanbanRenderer {
	private host: HTMLElement;
	private handlers: KanbanHandlers;
	/** The cards by row id, so a drag can find what it is carrying. */
	private cards = new Map<string, HTMLElement>();
	/** The column currently grouped by, so the menu can tick it. */
	private groupedBy = '';

	constructor(host: HTMLElement, handlers: KanbanHandlers) {
		this.host = host;
		this.handlers = handlers;
	}

	render(doc: LayerDoc, view: KanbanView): void {
		this.host.empty();
		this.host.addClass('layer-kanban');
		this.cards.clear();

		const groupField = doc.fields.find(
			(field) => field.id === view.groupByFieldId,
		);
		if (!groupField) {
			this.renderMissing(doc);
			return;
		}

		// The board honours the view's filter and order, so it shows the same rows
		// the table would: two views of one table should not disagree about which
		// rows exist.
		const visible = sortRecords(
			filterRecords(doc.records, doc.fields, view.filter, (field, value) => {
				const record = { id: '', created: '', cells: { [field.id]: value } };
				return this.handlers.displayText(field, record)
					.split(', ')
					.filter((name) => name !== '');
			}),
			doc.fields,
			view.sorts,
		);

		const columns = groupRecords(
			visible,
			groupField,
			columnLimitOf(view),
			(field, record) => this.handlers.displayText(field, record),
			view.showEmptyColumns === true,
		);
		const byId = new Map(doc.records.map((record) => [record.id, record]));
		// What a card prints comes from the board's own settings, resolved in one
		// place so the panel and the renderer cannot disagree.
		const cardColumns = cardColumnsFor(doc.fields, view);

		this.groupedBy = groupField.id;
		this.renderHead(view, groupField);

		const board = this.host.createDiv({ cls: 'layer-kanban-board' });
		for (const column of columns) {
			this.renderColumn(board, column, groupField, byId, cardColumns);
		}

		// What the limit left out, so a board that draws fewer columns than it has
		// says so instead of looking complete.
		const total = groupRecords(
			visible,
			groupField,
			Number.MAX_SAFE_INTEGER,
			(field, record) => this.handlers.displayText(field, record),
			view.showEmptyColumns === true,
		).length;
		if (total > columns.length) {
			this.host.createDiv({
				cls: 'layer-kanban-omitted',
				text: t().kanbanOmittedColumns(total - columns.length),
			});
		}
	}

	/**
	 * The strip above the columns: what the board groups by, and its column limit.
	 *
	 * The grouping control picks the column rather than editing it: its label is the
	 * column's name, so a reader takes it for a chooser, and opening a field editor
	 * from here would answer a question nobody asked. Editing a column stays where
	 * columns are edited — the table's header.
	 *
	 * The limit belongs to the board rather than the table, because one table may
	 * have several boards and a board of dates needs a different ceiling from a
	 * board of choices. It is edited here because this is where its effect is seen.
	 */
	private renderHead(view: KanbanView, groupField: Field): void {
		const head = this.host.createDiv({ cls: 'layer-kanban-toolbar' });


		/*
		 * The grouping column is shown, not offered: changing it belongs in the
		 * fields panel, which is where the card's other columns are chosen. Two
		 * controls that both change it would leave the reader wondering which one
		 * speaks for the board.
		 */
		const group = head.createSpan({ cls: 'layer-kanban-group' });
		setIcon(group.createSpan({ cls: 'layer-kanban-group-icon' }), 'columns');
		group.createSpan({ text: groupField.name });
		setTooltip(group, t().kanbanGroupedBy(groupField.name));

		head.createDiv({ cls: 'layer-kanban-toolbar-spacer' });

		// Whether the board shows columns no row uses yet, which is what makes an
		// unused choice reachable by dragging.
		const emptyLabel = head.createEl('label', { cls: 'layer-kanban-toggle' });
		const emptyBox = emptyLabel.createEl('input', { type: 'checkbox' });
		emptyBox.checked = view.showEmptyColumns === true;
		emptyLabel.createSpan({ text: t().kanbanShowEmpty });
		setTooltip(emptyLabel, t().kanbanShowEmptyHint);
		emptyBox.addEventListener('change', () => {
			this.handlers.onSetShowEmpty(emptyBox.checked);
		});

		const limitLabel = head.createEl('label', { cls: 'layer-kanban-limit' });
		limitLabel.createSpan({ text: t().kanbanColumnLimit });
		const input = limitLabel.createEl('input', { type: 'number' });
		input.value = String(columnLimitOf(view));
		input.min = '1';
		input.max = '500';
		setTooltip(input, t().kanbanColumnLimitHint);
		const commit = (): void => {
			const parsed = Number(input.value);
			if (!Number.isFinite(parsed)) {
				input.value = String(columnLimitOf(view));
				return;
			}
			this.handlers.onSetColumnLimit(
				Math.max(1, Math.min(Math.floor(parsed), 500)),
			);
		};
		input.addEventListener('change', commit);
	}

	/**
	 * Offers the columns this board could group by.
	 *
	 * Every column is offered, since a board groups by whatever its cells show —
	 * except the one already in use, which is ticked rather than repeated.
	 */
	private showGroupMenu(anchor: HTMLElement, fields: readonly Field[]): void {
		const menu = new Menu();
		for (const field of fields) {
			menu.addItem((item) =>
				item
					.setTitle(field.name)
					.setChecked(field.id === this.groupedBy)
					.onClick(() => {
						if (field.id !== this.groupedBy) {
							this.handlers.onSetGroupField(field.id);
						}
					}),
			);
		}
		const box = anchor.getBoundingClientRect();
		menu.showAtPosition({ x: box.left, y: box.bottom });
	}

	/** One column: its header, then its cards. */
	private renderColumn(
		board: HTMLElement,
		column: KanbanColumn,
		groupField: Field,
		byId: ReadonlyMap<string, LayerRecord>,
		cardColumns: CardColumns,
	): void {
		const host = board.createDiv({ cls: 'layer-kanban-column' });
		host.dataset.columnTitle = column.title;
		if (column.droppable) {
			this.attachDropTarget(host, column, groupField);
		}

		const head = host.createDiv({ cls: 'layer-kanban-head' });
		const ungrouped = column.value === null;
		head.createSpan({
			cls: 'layer-kanban-title',
			text: ungrouped ? t().kanbanUngrouped : column.title,
		});
		// The count is what tells an empty column apart from one the limit emptied.
		head.createSpan({
			cls: 'layer-kanban-count',
			text: String(column.recordIds.length),
		});
		if (ungrouped) {
			setTooltip(head, t().kanbanUngroupedHint);
		}

		const list = host.createDiv({ cls: 'layer-kanban-cards' });
		for (const recordId of column.recordIds) {
			const record = byId.get(recordId);
			if (!record) {
				continue;
			}
			this.renderCard(list, record, cardColumns, column, groupField);
		}

		if (column.recordIds.length === 0) {
			list.createDiv({ cls: 'layer-kanban-empty', text: t().kanbanEmptyColumn });
		}
	}

	/** One card: the row's title, and nothing else unless it is asked for. */
	private renderCard(
		list: HTMLElement,
		record: LayerRecord,
		columns: CardColumns,
		column: KanbanColumn,
		groupField: Field,
	): void {
		const card = list.createDiv({ cls: 'layer-kanban-card' });
		card.dataset.recordId = record.id;
		const title = columns.title
			? this.handlers.displayText(columns.title, record)
			: record.id;
		card.createSpan({
			cls: 'layer-kanban-card-title',
			text: title === '' ? t().kanbanUntitled : title,
		});

		/*
		 * The columns the reader chose to see, each as a small line. A field whose
		 * cell is empty is left out: a card of empty labels would be longer than the
		 * information in it.
		 */
		for (const field of columns.shown) {
			const text = this.handlers.displayText(field, record);
			if (text.trim() === '') {
				continue;
			}
			const line = card.createDiv({ cls: 'layer-kanban-card-field' });
			/*
			 * The column's own type icon, which is how the table's header marks it: a
			 * card showing six fields reads faster when the date and the number look
			 * different from the text.
			 */
			const icon = line.createSpan({ cls: 'layer-kanban-card-icon' });
			setIcon(icon, specFor(field.type).icon);
			line.createSpan({ cls: 'layer-kanban-card-label', text: field.name });
			line.createSpan({ cls: 'layer-kanban-card-value', text });
		}

		// A card only drags when its drop would write somewhere: a computed column
		// has no value to write, so its cards stay put.
		if (column.droppable) {
			card.draggable = true;
			card.addEventListener('dragstart', (event) => {
				event.dataTransfer?.setData('text/plain', record.id);
				card.addClass('is-dragging');
			});
			card.addEventListener('dragend', () => {
				card.removeClass('is-dragging');
			});
		} else {
			card.addClass('is-fixed');
			setTooltip(card, t().kanbanFixedGroup);
		}

		// Clicking opens the row in the table, which is where it is edited: a card
		// shows a title and nothing else, so editing belongs somewhere with room.
		card.addEventListener('click', () => {
			this.handlers.onOpenRecord(record.id);
		});
		void groupField;
		this.cards.set(record.id, card);
	}

	/** Lets a column receive a dragged card, if it may. */
	private attachDropTarget(
		host: HTMLElement,
		column: KanbanColumn,
		groupField: Field,
	): void {
		host.addEventListener('dragover', (event) => {
			event.preventDefault();
			host.addClass('is-drop-target');
		});
		host.addEventListener('dragleave', () => {
			host.removeClass('is-drop-target');
		});
		host.addEventListener('drop', (event) => {
			event.preventDefault();
			host.removeClass('is-drop-target');
			const recordId = event.dataTransfer?.getData('text/plain') ?? '';
			if (recordId === '') {
				return;
			}
			void groupField;
			this.handlers.onMove({ recordId, column });
		});
	}

	/**
	 * A board whose grouping column is gone says so, and offers a way to fix it.
	 *
	 * The repair is a button rather than something that happens on render: opening a
	 * panel by merely looking at a board would be a window nobody asked for.
	 */
	private renderMissing(doc: LayerDoc): void {
		const wrap = this.host.createDiv({ cls: 'layer-kanban-missing' });
		setIcon(wrap.createSpan({ cls: 'layer-kanban-missing-icon' }), 'columns');
		wrap.createDiv({ text: t().kanbanNoGroupField });
		if (doc.fields.length === 0) {
			return;
		}
		const pick = wrap.createEl('button', { text: t().kanbanChooseGroup });
		pick.addEventListener('click', () => {
			this.showGroupMenu(pick, doc.fields);
		});
	}
}

/** The value a drop writes, exposed so the view and the tests agree on the rule. */
export { valueForColumn };
