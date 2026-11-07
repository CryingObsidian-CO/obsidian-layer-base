import { Modal, type App } from 'obsidian';
import { t } from '../i18n';

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
		confirm.addEventListener('click', () => this.run());

		/*
		 * Enter answers the button that has the focus, and answers it once. It is
		 * taken here rather than left to the browser because the key would otherwise
		 * confirm from wherever the focus happened to be: a reader who tabbed to
		 * Cancel and pressed Enter meant to cancel, and got the destructive action.
		 */
		this.scope.register([], 'Enter', (event) => {
			event.preventDefault();
			if (event.target === cancel) {
				this.close();
				return;
			}
			this.run();
		});

		// The cancel button takes the focus, so an Enter typed before reading the
		// dialog dismisses it instead of running the action it warns about.
		cancel.focus();
	}

	/** Runs the action, once, whichever button or key asked for it. */
	private run(): void {
		this.close();
		this.config.onConfirm();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
