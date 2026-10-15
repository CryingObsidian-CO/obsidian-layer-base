import { clampColumnWidth, clampRowHeight } from '../../model/layout';

const DRAG_THRESHOLD_PX = 2;

export interface ResizeHandlers {
	/** The size right now, before this gesture starts. */
	onStart(): number;
	/** Called continuously while dragging. `pixels` is already clamped. */
	onPreview(pixels: number): void;
	/** Called once on release with the final size. */
	onCommit(pixels: number): void;
}

/**
 * The size a drag has arrived at, or null while it is still too small to count.
 *
 * Separate from the event handling so the rule is testable on its own, and so
 * that the one thing this must never do — measure from a size other than the
 * one read at the start of *this* gesture — is visible in the signature: the
 * caller supplies `startSize` per gesture and there is nowhere to keep a stale
 * copy.
 */
export function resizeSizeAt(
	startSize: number,
	startPointer: number,
	pointer: number,
	clamp: (value: number) => number,
): number | null {
	const delta = pointer - startPointer;
	if (Math.abs(delta) < DRAG_THRESHOLD_PX) {
		return null;
	}
	return clamp(startSize + delta);
}

export function attachColumnResize(
	handle: HTMLElement,
	handlers: ResizeHandlers,
): void {
	attachResize(handle, 'col-resize', clampColumnWidth, handlers);
}

export function attachRowResize(
	handle: HTMLElement,
	handlers: ResizeHandlers,
): void {
	attachResize(handle, 'row-resize', clampRowHeight, handlers);
}

function attachResize(
	handle: HTMLElement,
	axis: 'col-resize' | 'row-resize',
	clamp: (value: number) => number,
	handlers: ResizeHandlers,
): void {
	handle.addClass('layer-grid-resize', `is-${axis}`);
	handle.addEventListener('click', (event) => event.stopPropagation());
	handle.addEventListener('dblclick', (event) => event.stopPropagation());

	handle.addEventListener('mousedown', (event) => {
		if (event.button !== 0) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();

		/*
		 * Read the size as the pointer goes down, not when the handle was
		 * attached. A resize writes the document and leaves the column where the
		 * drag put it, so a value captured at attach time goes stale after the
		 * first resize, and every later gesture is computed from the width the
		 * column had when the table was last built. The column snaps back to that
		 * width before it follows the pointer.
		 */
		const startSize = handlers.onStart();

		const startPointer = axis === 'col-resize' ? event.clientX : event.clientY;
		let moved = false;
		let latest = startSize;

		const onMove = (move: MouseEvent) => {
			const pointer =
				axis === 'col-resize' ? move.clientX : move.clientY;
			const size = resizeSizeAt(startSize, startPointer, pointer, clamp);
			if (size === null) {
				return;
			}
			moved = true;
			latest = size;
			handlers.onPreview(latest);
		};

		const onUp = () => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
			document.body.removeClass('layer-grid-resizing');
			if (moved) {
				handlers.onCommit(latest);
			}
		};

		document.body.addClass('layer-grid-resizing', `is-${axis}`);
		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
	});
}