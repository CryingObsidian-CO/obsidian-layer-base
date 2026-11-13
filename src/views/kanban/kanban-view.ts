import { Menu, setIcon, setTooltip } from 'obsidian';
import { t } from '../../i18n';
import type { Field, KanbanView, LayerDoc, LayerRecord, NoteLabelStyle } from '../../types';
import type { CardColumns } from '../../model/kanban';
import { noteLabel } from '../../model/note-path';
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
	onSetGroupField(fieldId: string): void;
	onSetColumnLimit(limit: number): void;
	onSetShowEmpty(show: boolean): void;
	onMove(index: { recordId: string; column: KanbanColumn }): void;
	onOpenRecord(recordId: string): void;
	/** The board cannot reach the vault itself. */
	onOpenNote(path: string): void;

	noteLabelStyle(): NoteLabelStyle;

	/** Reads a cell the model cannot read by itself; null means "not mine". */
	cellText(field: Field, record: LayerRecord): string | null;
	displayText(field: Field, record: LayerRecord): string;
}

/**
 * One column per value of the grouping column, one card per row. Rows are grouped by the text
 * the column shows, so a multiple-value column keeps each distinct selection in one column.
 */
export class KanbanRenderer {
	private host: HTMLElement;
	private handlers: KanbanHandlers;
	private cards = new Map<string, HTMLElement>();
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

		// The board honours the view's filter and order, so it shows the rows the table would.
		const visible = sortRecords(
			filterRecords(
				doc.records,
				doc.fields,
				view.filter,
				(field, value) => {
					const record = { id: '', created: '', cells: { [field.id]: value } };
					return this.handlers.displayText(field, record)
						.split(', ')
						.filter((name) => name !== '');
				},
				(field, record) => this.handlers.cellText(field, record),
			),
			doc.fields,
			view.sorts,
			(field, record) => this.handlers.cellText(field, record),
		);

		const columns = groupRecords(
			visible,
			groupField,
			columnLimitOf(view),
			(field, record) => this.handlers.displayText(field, record),
			view.showEmptyColumns === true,
		);
		const byId = new Map(doc.records.map((record) => [record.id, record]));
		// Resolved in one place, so the settings panel and this renderer cannot disagree.
		const cardColumns = cardColumnsFor(doc.fields, view);

		this.groupedBy = groupField.id;
		this.renderHead(view, groupField);

		const board = this.host.createDiv({ cls: 'layer-kanban-board' });
		for (const column of columns) {
			this.renderColumn(board, column, groupField, byId, cardColumns);
		}

		// What the limit left out, so a board drawing fewer columns than it has does not look complete.
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

	// The limit belongs to the board, not the table: one table may have several boards, each
	// needing its own ceiling.
	private renderHead(view: KanbanView, groupField: Field): void {
		const head = this.host.createDiv({ cls: 'layer-kanban-toolbar' });


		const group = head.createSpan({ cls: 'layer-kanban-group' });
		setIcon(group.createSpan({ cls: 'layer-kanban-group-icon' }), 'columns');
		group.createSpan({ text: groupField.name });
		setTooltip(group, t().kanbanGroupedBy(groupField.name));

		head.createDiv({ cls: 'layer-kanban-toolbar-spacer' });

		// Showing empty columns is what makes an unused choice reachable by dragging.
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

		for (const field of columns.shown) {
			const text = this.handlers.displayText(field, record);
			if (text.trim() === '') {
				continue;
			}
			const line = card.createDiv({ cls: 'layer-kanban-card-field' });
			const icon = line.createSpan({ cls: 'layer-kanban-card-icon' });
			setIcon(icon, specFor(field.type).icon);
			line.createSpan({ cls: 'layer-kanban-card-label', text: field.name });
			if (field.type === 'note') {
				// The card underneath would take the click as "open this row", so it is kept from it.
				const link = line.createEl('a', {
					cls: 'layer-kanban-card-link',
					text: noteLabel(text, this.handlers.noteLabelStyle()),
				});
				link.setAttribute('href', '#');
				link.addEventListener('click', (event) => {
					event.preventDefault();
					event.stopPropagation();
					this.handlers.onOpenNote(text);
				});
			} else {
				line.createSpan({ cls: 'layer-kanban-card-value', text });
			}
		}

		// A card only drags when its drop would write somewhere; a computed column has nowhere.
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

		card.addEventListener('click', () => {
			this.handlers.onOpenRecord(record.id);
		});
		void groupField;
		this.cards.set(record.id, card);
	}

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

	// A button rather than automatic: opening a panel just because a board was looked at
	// would be a window nobody asked for.
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
