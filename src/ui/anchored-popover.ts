import {Modal, type App} from 'obsidian';
import {anchorRectOf, placeAtAnchor, type Anchor} from './anchor-placement';

export type {Anchor};

/** A `Modal` placed against what opened it rather than centred. */
export abstract class AnchoredPopover extends Modal {
	/** Read in the constructor: the trigger may be gone by the time the panel opens. */
	private readonly anchorRect: DOMRect | null;

	constructor(
		app: App,
		anchor: Anchor | null,
		private readonly width: string,
	) {
		super(app);
		this.anchorRect = anchorRectOf(anchor);
	}

	onOpen(): void {
		this.titleEl.hide();
		this.modalEl.addClass('layer-popover');
		this.containerEl.addClass('layer-popover-host');
		this.setWidth();
		this.scope.register([], 'Escape', (event) => {
			if (this.handlesEscape()) {
				return;
			}
			event.preventDefault();
			this.close();
		});
	}

	protected handlesEscape(): boolean {
		return false;
	}

	/** Inline and `!important`: no stylesheet rule moves a modal's own width. */
	private setWidth(): void {
		const style = this.modalEl.style;
		style.setProperty('width', this.width, 'important');
		style.setProperty('max-width', this.width, 'important');
		style.setProperty('min-width', '0', 'important');
	}

	override onClose(): void {
		this.modalEl.removeClass('layer-popover');
		this.containerEl.removeClass('layer-popover-host');
	}

	/** Call once the contents are rendered. */
	protected position(): void {
		const panel = this.modalEl;
		if (!this.anchorRect) {
			return;
		}
		// Re-applied: Obsidian sizes the modal once its contents are laid out.
		this.setWidth();
		placeAtAnchor(panel, this.anchorRect, panel.getBoundingClientRect());
	}
}
