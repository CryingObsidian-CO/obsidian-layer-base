import { Modal, setIcon, setTooltip, type App } from 'obsidian';
import { t } from '../i18n';
import type { Field, FormulaResultType } from '../types';
import { fieldsUsed, parseFormula } from '../model/formula/parser';
import {
	FORMULA_FUNCTION_GROUPS,
	FORMULA_SYMBOL_GROUPS,
} from '../model/formula/eval';
import {
	formulaErrorMessage,
	formulaFunctionHelp,
	formulaGroupLabel,
	formulaSymbolHelp,
} from './formula-text';

export interface FormulaModalOptions {
	app: App;
	/** The expression being edited, as it stood when the panel opened. */
	formula: string;
	/** How its result is presented, or null to follow whatever it computed. */
	formulaType: FormulaResultType | null;
	/** The columns a formula may refer to, in the order they are offered. */
	fields: readonly Field[];
	onSubmit: (result: FormulaModalResult) => void;
}

/** What the panel reports back: the expression and how to dress its result. */
export interface FormulaModalResult {
	formula: string;
	formulaType: FormulaResultType | null;
}

/**
 * The formula editor: its own centred panel rather than a box inside the field
 * editor, because writing an expression is a different kind of work from naming
 * a column and wants the room.
 *
 * The text is kept in the textarea and only reported on submit; the live read
 * below it says whether what is typed can run, so a mistake is caught here rather
 * than as `#error` in every cell afterwards.
 */
export class FormulaModal extends Modal {
	private draft: string;
	private formulaType: FormulaResultType | null;
	private errorEl: HTMLElement | null = null;
	private previewEl: HTMLElement | null = null;
	private input: HTMLTextAreaElement | null = null;

	constructor(private readonly config: FormulaModalOptions) {
		super(config.app);
		this.draft = config.formula;
		this.formulaType = config.formulaType;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('layer-formula-editor');
		this.modalEl.addClass('layer-formula-modal');

		contentEl.createEl('h2', { cls: 'layer-formula-title', text: t().formulaTitle });

		this.input = contentEl.createEl('textarea', {
			cls: 'layer-formula-input',
		});
		this.input.spellcheck = false;
		this.input.placeholder = t().fieldFormulaPlaceholder;
		this.input.value = this.draft;
		this.input.addEventListener('input', () => {
			this.draft = this.input?.value ?? '';
			this.paint();
		});
		// Enter writes a newline, so the panel is committed with `Ctrl/Cmd+Enter`.
		this.input.addEventListener('keydown', (event) => {
			if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
				event.preventDefault();
				this.submit();
			}
		});

		/*
		 * How the result is presented, beside the expression it describes: a column
		 * whose rows compute different kinds can be told to look like one kind.
		 */
		const typeRow = contentEl.createDiv({ cls: 'layer-formula-type' });
		typeRow.createSpan({
			cls: 'layer-formula-type-label',
			text: t().fieldFormulaTypeLabel,
		});
		const typeSelect = typeRow.createEl('select', {
			cls: 'layer-formula-type-select',
		});
		const choices: readonly (readonly [string, string])[] = [
			['', t().fieldFormulaTypeAuto],
			['number', t().fieldFormulaTypeNumber],
			['text', t().fieldFormulaTypeText],
			['boolean', t().fieldFormulaTypeBoolean],
		];
		for (const [value, label] of choices) {
			const option = typeSelect.createEl('option', { text: label });
			option.value = value;
		}
		typeSelect.value = this.formulaType ?? '';
		typeSelect.addEventListener('change', () => {
			const picked = typeSelect.value;
			this.formulaType =
				picked === 'number' || picked === 'text' || picked === 'boolean'
					? picked
					: null;
		});
		contentEl.createDiv({
			cls: 'layer-formula-type-hint',
			text: t().fieldFormulaTypeHint,
		});

		this.previewEl = contentEl.createDiv({ cls: 'layer-formula-preview' });
		this.errorEl = contentEl.createDiv({ cls: 'layer-formula-error' });

		this.renderFieldButtons(contentEl);
		this.renderSymbolButtons(contentEl);
		this.renderFunctionButtons(contentEl);

		contentEl.createDiv({
			cls: 'layer-formula-hint',
			text: t().fieldFormulaHint,
		});

		const actions = contentEl.createDiv({ cls: 'layer-formula-actions' });
		const cancel = actions.createEl('button', { text: t().cancel });
		cancel.addEventListener('click', () => this.close());
		const confirm = actions.createEl('button', {
			cls: 'mod-cta',
			text: t().formulaConfirm,
		});
		confirm.addEventListener('click', () => this.submit());

		this.paint();
		window.setTimeout(() => this.input?.focus(), 0);
	}

	/** Inserts text at the caret, replacing what is selected, as typing would. */
	private insert(text: string): void {
		const input = this.input;
		if (!input) {
			return;
		}
		const start = input.selectionStart ?? input.value.length;
		const end = input.selectionEnd ?? start;
		input.value = input.value.slice(0, start) + text + input.value.slice(end);
		const caret = start + text.length;
		input.focus();
		input.setSelectionRange(caret, caret);
		this.draft = input.value;
		this.paint();
	}

	/** One button per column, so a reference is never typed from memory. */
	private renderFieldButtons(host: HTMLElement): void {
		const usable = this.config.fields;
		if (usable.length === 0) {
			return;
		}
		host.createDiv({ cls: 'layer-formula-heading', text: t().fieldFormulaInsert });
		const row = host.createDiv({ cls: 'layer-formula-chips' });
		for (const field of usable) {
			const button = row.createEl('button', { cls: 'layer-formula-chip' });
			const icon = button.createSpan({ cls: 'layer-formula-chip-icon' });
			setIcon(icon, 'brackets');
			button.createSpan({ text: field.name });
			button.addEventListener('click', () => this.insert(`{${field.name}}`));
		}
	}

	/**
	 * The symbols, offered before the functions because they are the simpler half of
	 * the language: someone who does not know the syntax can build `{数量} * {单价}`
	 * by pressing the buttons in order.
	 */
	private renderSymbolButtons(host: HTMLElement): void {
		host.createDiv({ cls: 'layer-formula-heading', text: t().formulaSymbols });
		for (const group of FORMULA_SYMBOL_GROUPS) {
			host.createDiv({
				cls: 'layer-formula-group',
				text: formulaGroupLabel(group.labelKey),
			});
			const row = host.createDiv({ cls: 'layer-formula-chips' });
			for (const entry of group.symbols) {
				const button = row.createEl('button', {
					cls: 'layer-formula-chip is-symbol',
				});
				button.setText(entry.symbol);
				// The character says it exists; the tooltip says what it is for.
				const help = formulaSymbolHelp(entry.symbol);
				if (help !== '') {
					setTooltip(button, help);
				}
				button.setAttribute('aria-label', `${entry.symbol}: ${help}`);
				button.addEventListener('click', () => this.insert(entry.symbol));
			}
		}
	}

	/**
	 * The functions, offered as buttons that insert a call and put the caret inside.
	 *
	 * Shown one group at a time, because a single run of every name gives the reader
	 * nothing to search by.
	 */
	private renderFunctionButtons(host: HTMLElement): void {
		host.createDiv({ cls: 'layer-formula-heading', text: t().formulaFunctions });
		for (const group of FORMULA_FUNCTION_GROUPS) {
			host.createDiv({
				cls: 'layer-formula-group',
				text: formulaGroupLabel(group.labelKey),
			});
			const row = host.createDiv({ cls: 'layer-formula-chips' });
			for (const name of group.functions) {
				const button = row.createEl('button', { cls: 'layer-formula-chip' });
				button.setText(name);
				// What the function does, so its name alone does not have to be
				// guessed at. `setTooltip` is Obsidian's own tooltip; a `title`
				// attribute as well would draw a second one on top of it.
				const help = formulaFunctionHelp(name);
				if (help !== '') {
					setTooltip(button, help);
				}
				button.setAttribute('aria-label', `${name}: ${help}`);
				button.addEventListener('click', () => this.insert(`${name}()`));
			}
		}
	}

	/** The names this document has, for checking what the formula reads. */
	private fieldNames(): string[] {
		return this.config.fields.map((field) => field.name);
	}

	/** Updates the read of what is typed: whether it runs, and what it reads. */
	private paint(): void {
		const preview = this.previewEl;
		const error = this.errorEl;
		if (!preview || !error) {
			return;
		}
		preview.empty();
		error.empty();
		error.removeClass('is-visible');

		if (this.draft.trim() === '') {
			preview.setText(t().formulaEmptyPreview);
			return;
		}

		const parsed = parseFormula(this.draft);
		if (!parsed.ok) {
			error.addClass('is-visible');
			error.setText(formulaErrorMessage(parsed.error));
			return;
		}

		const names = fieldsUsed(parsed.node);
		const missing = [...names].filter((name) => !this.fieldNames().includes(name));
		if (missing.length > 0) {
			error.addClass('is-visible');
			error.setText(`${t().formulaUnknownFields} ${missing.join(', ')}`);
			return;
		}
		preview.setText(t().formulaReads([...names]));
	}

	private submit(): void {
		this.config.onSubmit({
			formula: this.draft.trim(),
			formulaType: this.formulaType,
		});
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
