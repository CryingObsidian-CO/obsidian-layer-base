import { setIcon } from 'obsidian';
import { t } from '../i18n';
import type { Field, Sort } from '../types';
import { AnchoredPopover, type Anchor } from './anchored-popover';

const SORT_POPOVER_WIDTH = '22rem';

export interface SortPopoverOptions {
	app: AnchoredPopover['app'];
	anchor: Anchor | null;
	/** The columns that may be sorted, in the order the table shows them. */
	fields: readonly Field[];
	sorts: readonly Sort[];
	/** Reported on every change, so the table follows the panel as it is edited. */
	onChange: (sorts: Sort[]) => void;
}

/**
 * The sort rules of a view, in a panel beside the toolbar.
 *
 * Rules apply in the order they are listed, which is what makes a second rule mean
 * "when the first column ties": the panel is the only place that order is visible,
 * so the list is drawn as a numbered list rather than a set of independent rows.
 */
export class SortPopover extends AnchoredPopover {
	private rules: Sort[];

	constructor(private readonly config: SortPopoverOptions) {
		super(config.app, config.anchor, SORT_POPOVER_WIDTH);
		this.rules = config.sorts.map((sort) => ({ ...sort }));
	}

	onOpen(): void {
		super.onOpen();
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('layer-sort-panel');

		contentEl.createEl('h2', { cls: 'layer-sort-title', text: t().sortTitle });

		if (this.rules.length === 0) {
			contentEl.createDiv({
				cls: 'layer-sort-empty',
				text: t().sortEmpty,
			});
		}

		for (const [index, rule] of this.rules.entries()) {
			this.renderRule(contentEl, index, rule);
		}

		const add = contentEl.createEl('button', { cls: 'layer-sort-add' });
		setIcon(add.createSpan({ cls: 'layer-sort-add-icon' }), 'plus');
		add.createSpan({ text: t().sortAdd });
		add.addEventListener('click', (event) => {
			event.preventDefault();
			this.addRule();
		});

		this.position();
	}

	private renderRule(host: HTMLElement, index: number, rule: Sort): void {
		const row = host.createDiv({ cls: 'layer-sort-rule' });

		// The number is the priority: rule 2 only decides rows rule 1 left tied.
		row.createSpan({ cls: 'layer-sort-rank', text: String(index + 1) });

		const select = row.createEl('select', { cls: 'layer-sort-field' });
		for (const field of this.sortableFields()) {
			const option = select.createEl('option', { text: field.name });
			option.value = field.id;
		}
		select.value = rule.fieldId;
		select.addEventListener('change', () => {
			rule.fieldId = select.value;
			this.emit();
		});

		const order = row.createEl('button', { cls: 'layer-sort-order' });
		const paintOrder = (): void => {
			order.empty();
			const ascending = rule.order === 'asc';
			setIcon(order.createSpan(), ascending ? 'arrow-up' : 'arrow-down');
			order.createSpan({ text: ascending ? t().sortAsc : t().sortDesc });
			order.setAttribute(
				'aria-label',
				ascending ? t().sortAscendingHint : t().sortDescendingHint,
			);
		};
		paintOrder();
		order.addEventListener('click', (event) => {
			event.preventDefault();
			rule.order = rule.order === 'asc' ? 'desc' : 'asc';
			paintOrder();
			this.emit();
		});

		const remove = row.createEl('button', { cls: 'layer-sort-remove' });
		setIcon(remove.createSpan(), 'x');
		remove.setAttribute('aria-label', t().sortRemove);
		remove.addEventListener('click', (event) => {
			event.preventDefault();
			this.rules = this.rules.filter((candidate) => candidate !== rule);
			this.emit();
			this.render();
		});
	}

	/** The columns this panel may offer: every one, computed ones included. */
	private sortableFields(): readonly Field[] {
		return this.config.fields;
	}

	private addRule(): void {
		const available = this.sortableFields();
		if (available.length === 0) {
			return;
		}
		/*
		 * Any column may be added again, including one already sorting: a repeat is
		 * harmless, since it can only decide rows the earlier rule left tied.
		 */
		const first = available[0];
		if (!first) {
			return;
		}
		this.rules = [...this.rules, { fieldId: first.id, order: 'asc' }];
		this.emit();
		this.render();
	}

	/** Tells the view what the rules are now, and lets it redraw the table. */
	private emit(): void {
		this.config.onChange(this.rules.map((rule) => ({ ...rule })));
	}

	/** Keeps a rule pointing at a column that is still here. */
	override onClose(): void {
		super.onClose();
		const known = new Set(this.sortableFields().map((field) => field.id));
		const kept = this.rules.filter((rule) => known.has(rule.fieldId));
		if (kept.length !== this.rules.length) {
			this.config.onChange(kept.map((rule) => ({ ...rule })));
		}
	}
}