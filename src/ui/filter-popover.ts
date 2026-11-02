import { setIcon } from 'obsidian';
import { t } from '../i18n';
import { operatorsFor } from '../model/filter';
import type { Field, Filter, FilterCondition } from '../types';
import { AnchoredPopover, type Anchor } from './anchored-popover';
import { renderConditionRow } from './condition-row';

const FILTER_POPOVER_WIDTH = '26rem';

export interface FilterPopoverOptions {
	app: AnchoredPopover['app'];
	anchor: Anchor | null;
	/** The columns that may be filtered on, in the order the table shows them. */
	fields: readonly Field[];
	filter: Filter;
	/** Reported on every change, so the table follows the panel as it is edited. */
	onChange: (filter: Filter) => void;
}

/**
 * The filter rules of a view, in a panel beside the toolbar.
 *
 * Conditions are combined as a whole, not in groups: the model has one conjunction
 * and a list, so the panel offers a single choice between "all" and "any" rather
 * than inventing a tree of conditions it could not save.
 */
export class FilterPopover extends AnchoredPopover {
	private conjunction: 'and' | 'or';
	private conditions: FilterCondition[];

	constructor(private readonly config: FilterPopoverOptions) {
		super(config.app, config.anchor, FILTER_POPOVER_WIDTH);
		this.conjunction = config.filter.conjunction;
		this.conditions = config.filter.conditions.map((condition) => ({
			...condition,
		}));
	}

	onOpen(): void {
		super.onOpen();
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('layer-filter-panel');

		contentEl.createEl('h2', { cls: 'layer-filter-title', text: t().filterTitle });

		if (this.conditions.length === 0) {
			contentEl.createDiv({
				cls: 'layer-filter-empty',
				text: t().filterEmpty,
			});
		} else if (this.conditions.length > 1) {
			this.renderConjunction(contentEl);
		}

		for (const condition of this.conditions) {
			this.renderCondition(contentEl, condition);
		}

		const add = contentEl.createEl('button', { cls: 'layer-filter-add' });
		setIcon(add.createSpan({ cls: 'layer-filter-add-icon' }), 'plus');
		add.createSpan({ text: t().filterAdd });
		add.addEventListener('click', (event) => {
			event.preventDefault();
			this.addCondition();
		});

		this.position();
	}

	/** The single choice between requiring all conditions or any of them. */
	private renderConjunction(host: HTMLElement): void {
		const row = host.createDiv({ cls: 'layer-filter-conjunction' });
		for (const option of ['and', 'or'] as const) {
			const button = row.createEl('button', { cls: 'layer-filter-mode' });
			button.toggleClass('is-active', this.conjunction === option);
			button.setText(option === 'and' ? t().filterAll : t().filterAny);
			button.addEventListener('click', (event) => {
				event.preventDefault();
				this.conjunction = option;
				this.emit();
				this.render();
			});
		}
	}

	private renderCondition(host: HTMLElement, condition: FilterCondition): void {
		const row = host.createDiv({ cls: 'layer-condition' });
		renderConditionRow(row, {
			fields: this.filterableFields(),
			condition,
			onChange: (redraw) => {
				this.emit();
				if (redraw) {
					this.render();
				}
			},
		});

		const remove = row.createEl('button', { cls: 'layer-condition-remove' });
		setIcon(remove.createSpan(), 'x');
		remove.setAttribute('aria-label', t().filterRemove);
		remove.addEventListener('click', (event) => {
			event.preventDefault();
			this.conditions = this.conditions.filter(
				(candidate) => candidate !== condition,
			);
			this.emit();
			this.render();
		});
	}

	private filterableFields(): readonly Field[] {
		// Every column, computed ones included: the view hands their text to the filter.
		return this.config.fields;
	}

	private addCondition(): void {
		const first = this.filterableFields()[0];
		if (!first) {
			return;
		}
		// Repeats are allowed for the same reason as in the sort panel: they are
		// harmless, and refusing them makes the button look broken.
		this.conditions = [
			...this.conditions,
			{ fieldId: first.id, operator: operatorsFor(first)[0] ?? 'is', value: '' },
		];
		this.emit();
		this.render();
	}

	private emit(): void {
		this.config.onChange({
			conjunction: this.conjunction,
			conditions: this.conditions.map((condition) => ({ ...condition })),
		});
	}

	/** Keeps a condition pointing at a column that is still here. */
	override onClose(): void {
		super.onClose();
		const known = new Set(this.filterableFields().map((field) => field.id));
		const kept = this.conditions.filter((condition) => known.has(condition.fieldId));
		if (kept.length !== this.conditions.length) {
			this.config.onChange({
				conjunction: this.conjunction,
				conditions: kept.map((condition) => ({ ...condition })),
			});
		}
	}
}
