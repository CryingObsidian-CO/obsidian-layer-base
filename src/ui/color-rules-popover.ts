import { setIcon } from 'obsidian';
import { t } from '../i18n';
import { colorRulesOf } from '../model/colors';
import { operatorsFor } from '../model/filter';
import { OPTION_PALETTE, optionColorHex } from '../model/select-options';
import type { ColorRule, Field, GridView } from '../types';
import { AnchoredPopover, type Anchor } from './anchored-popover';
import { renderConditionRow } from './condition-row';

const COLOR_PANEL_WIDTH = '30rem';

export interface ColorRulesOptions {
	app: AnchoredPopover['app'];
	anchor: Anchor | null;
	view: GridView;
	/** The columns a rule may name, in the order the table shows them. */
	fields: readonly Field[];
	/** Reported on every change, so the table follows the panel as it is edited. */
	onChange: (rules: ColorRule[]) => void;
}

/**
 * The colours this view's rows wear, and what makes them wear it.
 *
 * A rule is a filter condition plus a colour, so a row can be read before its
 * column is: the reading is "when this column says this, the row is blue".
 */
export class ColorRulesPopover extends AnchoredPopover {
	private rules: ColorRule[];

	constructor(private readonly config: ColorRulesOptions) {
		super(config.app, config.anchor, COLOR_PANEL_WIDTH);
		this.rules = colorRulesOf(config.view).map((rule) => ({ ...rule }));
	}

	onOpen(): void {
		super.onOpen();
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('layer-color-panel');

		contentEl.createEl('h2', {
			cls: 'layer-color-title',
			text: t().colorRulesTitle,
		});

		if (this.rules.length === 0) {
			contentEl.createDiv({
				cls: 'layer-color-empty',
				text: t().colorRulesEmpty,
			});
		}

		for (const rule of this.rules) {
			this.renderRule(contentEl, rule);
		}

		const add = contentEl.createEl('button', { cls: 'layer-color-add' });
		setIcon(add.createSpan({ cls: 'layer-color-add-icon' }), 'plus');
		add.createSpan({ text: t().colorRuleAdd });
		add.addEventListener('click', (event) => {
			event.preventDefault();
			this.addRule();
		});

		this.position();
	}

	private renderRule(host: HTMLElement, rule: ColorRule): void {
		const block = host.createDiv({ cls: 'layer-color-rule' });

		const when = block.createDiv({ cls: 'layer-color-line' });
		when.createSpan({ cls: 'layer-color-label', text: t().colorRuleWhen });
		renderConditionRow(when, {
			fields: this.config.fields,
			condition: rule,
			onChange: (redraw) => {
				this.emit();
				if (redraw) {
					this.render();
				}
			},
		});

		const remove = when.createEl('button', { cls: 'layer-condition-remove' });
		setIcon(remove.createSpan(), 'x');
		remove.setAttribute('aria-label', t().colorRuleRemove);
		remove.addEventListener('click', (event) => {
			event.preventDefault();
			this.rules = this.rules.filter((candidate) => candidate !== rule);
			this.emit();
			this.render();
		});

		const colorLine = block.createDiv({ cls: 'layer-color-line' });
		colorLine.createSpan({ cls: 'layer-color-label', text: t().colorRuleColor });
		const swatches = colorLine.createDiv({ cls: 'layer-color-swatches' });
		for (const name of OPTION_PALETTE) {
			const dot = swatches.createEl('button', { cls: 'layer-color-swatch' });
			dot.toggleClass('is-active', name === rule.color);
			dot.setAttribute('aria-label', name);
			/*
			 * The colour goes on a child, not on the button: this app gives every
			 * button a background of its own, and a dot painted on the button would
			 * be overruled by it and come out the colour of the panel.
			 */
			dot.createSpan({
				cls: 'layer-color-swatch-fill',
			}).style.backgroundColor = optionColorHex(name);
			dot.addEventListener('click', (event) => {
				event.preventDefault();
				rule.color = name;
				this.emit();
				this.render();
			});
		}
	}

	private addRule(): void {
		const first = this.config.fields[0];
		if (!first) {
			return;
		}
		// Repeats are allowed for the same reason as in the filter panel: they are
		// harmless, and refusing them makes the button look broken.
		this.rules = [
			...this.rules,
			{
				fieldId: first.id,
				operator: operatorsFor(first)[0] ?? 'is',
				value: '',
				color: OPTION_PALETTE[0] ?? 'blue',
			},
		];
		this.emit();
		this.render();
	}

	private emit(): void {
		this.config.onChange(this.rules.map((rule) => ({ ...rule })));
	}

	/** Keeps rules pointing at columns that are still here. */
	override onClose(): void {
		super.onClose();
		const known = new Set(this.config.fields.map((field) => field.id));
		const kept = this.rules.filter((rule) => known.has(rule.fieldId));
		if (kept.length !== this.rules.length) {
			this.config.onChange(kept.map((rule) => ({ ...rule })));
		}
	}
}
