export type Anchor =
	| { kind: 'element'; el: HTMLElement }
	| { kind: 'point'; x: number; y: number };

export interface Viewport {
	width: number;
	height: number;
}

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

	// The margin counts against the room: a panel below starts at anchor.bottom + margin.
	const spaceBelow = size.height - anchor.bottom - margin;
	const spaceAbove = anchor.top - margin;
	const openAbove = panelRect.height > spaceBelow && spaceAbove > spaceBelow;

	// Held inside the window: a trigger at the top has no room above, one scrolled
	// past the end of it no room below.
	const wanted = openAbove
		? anchor.top - panelRect.height - margin
		: anchor.bottom + margin;
	const maxTop = Math.max(margin, size.height - panelRect.height - margin);
	const top = Math.min(Math.max(margin, wanted), maxTop);

	// The margin floor is applied last: for a panel wider than the window the right cap
	// is below it or negative, and the panel would slide off the left edge.
	const rightmost = size.width - panelRect.width - margin;
	const left = Math.max(margin, Math.min(anchor.left, rightmost));

	panel.style.top = `${top}px`;
	panel.style.left = `${left}px`;
}
