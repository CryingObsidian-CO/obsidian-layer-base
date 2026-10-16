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

	const spaceBelow = size.height - anchor.bottom;
	const spaceAbove = anchor.top;
	const openAbove = panelRect.height > spaceBelow && spaceAbove > spaceBelow;

	const top = openAbove
		? Math.max(margin, anchor.top - panelRect.height - margin)
		: anchor.bottom + margin;

	// A trigger near the right edge would otherwise push the panel off-screen.
	const left = Math.min(
		Math.max(margin, anchor.left),
		size.width - panelRect.width - margin,
	);

	panel.style.top = `${top}px`;
	panel.style.left = `${left}px`;
}
