import { Modal, Setting, type App } from 'obsidian';
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

		new Setting(contentEl).setName(this.config.title).setHeading();
		contentEl.createEl('p', { text: this.config.message });

		const actions = contentEl.createDiv({ cls: 'layer-confirm-actions' });

		const cancel = actions.createEl('button', { text: t().cancel });
		cancel.addEventListener('click', () => this.close());

		const confirm = actions.createEl('button', {
			cls: 'mod-warning',
			text: this.config.confirmText,
		});
		confirm.addEventListener('click', () => this.run());

		// Taken here so Enter answers the focused button: left to the browser it would
		// confirm from wherever the focus happened to be, Cancel included.
		this.scope.register([], 'Enter', (event) => {
			event.preventDefault();
			if (event.target === cancel) {
				this.close();
				return;
			}
			this.run();
		});

		// Cancel takes the focus, so an Enter typed before reading dismisses the dialog
		// instead of running the action it warns about.
		cancel.focus();
	}

	private run(): void {
		this.close();
		this.config.onConfirm();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
