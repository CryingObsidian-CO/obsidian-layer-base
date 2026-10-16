import { Modal, type App } from 'obsidian';
import { anchorRectOf, placeAtAnchor, type Anchor } from './anchor-placement';

export type { Anchor };

/** A panel that opens next to what asked for it: a `Modal` with the centring taken over. */
export abstract class AnchoredPopover extends Modal {
	/** The anchor's rectangle, read before the trigger could disappear. */
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
		this.setWidth();
		this.scope.register([], 'Escape', (event) => {
			if (this.handlesEscape()) {
				return;
			}
			event.preventDefault();
			this.close();
		});
	}

	/** Whether a nested control should consume Escape instead of this panel. */
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
	}

	/** Places the panel; call once the contents are rendered. */
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
