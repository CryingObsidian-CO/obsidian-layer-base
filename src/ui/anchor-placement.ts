/** Where a panel opens: under an element, or at a point on screen. */
export type Anchor =
	| { kind: 'element'; el: HTMLElement }
	| { kind: 'point'; x: number; y: number };

/** The window the panel has to fit inside. */
export interface Viewport {
	width: number;
	height: number;
}

/** Reads an element's position now, while the trigger still exists. */
export function anchorRectOf(anchor: Anchor | null): DOMRect | null {
	if (anchor?.kind === 'element') {
		return anchor.el.getBoundingClientRect();
	}
	return anchor?.kind === 'point' ? new DOMRect(anchor.x, anchor.y, 0, 0) : null;
}

/** Puts `panel` below `anchor`, or above it when there is no room below. */
export function placeAtAnchor(
	panel: HTMLElement,
	anchor: DOMRect | null,
	panelRect: DOMRect,
	viewport?: Viewport,
): void {
	if (!anchor) {
		return;
	}
	const size = viewport ?? {
		width: window.innerWidth,
		height: window.innerHeight,
	};
	const margin = 8;

	/*
	 * Room for the panel on either side of the trigger, in the margin it would keep
	 * from the edge too: a panel placed below starts at `anchor.bottom + margin`, so
	 * the few pixels it would hang over the edge are not room it can use.
	 */
	const spaceBelow = size.height - anchor.bottom - margin;
	const spaceAbove = anchor.top - margin;
	const openAbove = panelRect.height > spaceBelow && spaceAbove > spaceBelow;

	/*
	 * Where it wants to be, then held inside the window. Above needs its own floor
	 * (a trigger near the top has no room to give), and below needs a ceiling: a tall
	 * panel, or a trigger already scrolled past the end of the window, would
	 * otherwise draw part of itself outside it.
	 */
	const wanted = openAbove
		? anchor.top - panelRect.height - margin
		: anchor.bottom + margin;
	const maxTop = Math.max(margin, size.height - panelRect.height - margin);
	const top = Math.min(Math.max(margin, wanted), maxTop);

	/*
	 * A trigger near the right edge would otherwise push the panel off-screen. The
	 * margin floor is applied last: a panel wider than the window cannot fit, and
	 * the cap on the right is then smaller than the margin — or negative — so
	 * without the floor the panel slid off the left edge instead of staying put and
	 * running off the right.
	 */
	const rightmost = size.width - panelRect.width - margin;
	const left = Math.max(margin, Math.min(anchor.left, rightmost));

	panel.style.top = `${top}px`;
	panel.style.left = `${left}px`;
}
