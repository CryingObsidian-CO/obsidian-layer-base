import { Modal, type App } from 'obsidian';
import { t } from '../i18n';

/**
 * A yes/no confirmation before a destructive action.
 *
 * Kept separate from the action itself so the irreversible step is always behind
 * one explicit click, and so the wording lives with the other UI strings.
 */
export interface ConfirmOptions {
	title: string;
	message: string;
	confirmText: string;
	onConfirm: () => void;
}

export class ConfirmModal extends Modal {
	constructor(
		app: App,
		private readonly config: ConfirmOptions,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('layer-confirm');

		contentEl.createEl('h2', { text: this.config.title });
		contentEl.createEl('p', { text: this.config.message });

		const actions = contentEl.createDiv({ cls: 'layer-confirm-actions' });

		const cancel = actions.createEl('button', { text: t().cancel });
		cancel.addEventListener('click', () => this.close());

		const confirm = actions.createEl('button', {
			cls: 'mod-warning',
			text: this.config.confirmText,
		});
		confirm.addEventListener('click', () => {
			// Close first: the callback may replace the view this modal is
			// floating above, and closing a modal whose owner is gone is messy.
			this.close();
			this.config.onConfirm();
		});

		// Enter confirms, Escape cancels, matching Obsidian's other dialogs.
		this.scope.register([], 'Enter', (event) => {
			event.preventDefault();
			this.close();
			this.config.onConfirm();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
