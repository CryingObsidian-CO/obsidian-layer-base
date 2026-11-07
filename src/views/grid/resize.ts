import { clampColumnWidth, clampRowHeight } from '../../model/layout';

const DRAG_THRESHOLD_PX = 2;

export interface ResizeHandlers {
	/** The size when the gesture starts. */
	onStart(): number;
	/** Called continuously while dragging, with a clamped size. */
	onPreview(pixels: number): void;
	/** Called once on release with the final size. */
	onCommit(pixels: number): void;
}

/** The size a drag has arrived at, or null while it is still below the threshold. */
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

	/**
	 * Ends a gesture that is still running, without keeping its size.
	 *
	 * A press that arrives while one is in flight means the first never saw its
	 * release. Its listeners are dropped here, so the two cannot move and commit the
	 * same column — and the width it previewed stays on screen, which is where the
	 * next gesture starts from anyway.
	 */
	let stopActiveResize: (() => void) | null = null;

	handle.addEventListener('mousedown', (event) => {
		if (event.button !== 0) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		stopActiveResize?.();

		// Read per gesture, not at attach time: a committed resize leaves the
		// column at the new width, so a captured value is stale by the next drag.
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

		const stopListening = () => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
			document.removeEventListener('mouseleave', onUp);
			window.removeEventListener('blur', onUp);
			/*
			 * Both classes go: the axis one asked for the cursor, and left behind it
			 * outlived the gesture — after a row drag, every later column drag carried
			 * `is-col-resize` and `is-row-resize` at once, and the rule further down the
			 * sheet kept the cursor pointing the wrong way.
			 */
			document.body.removeClass('layer-grid-resizing', `is-${axis}`);
			stopActiveResize = null;
		};

		/**
		 * Ends the gesture where it stands and keeps the size it reached.
		 *
		 * A release outside the window, a context menu, another pane taking the focus
		 * — none of them sends the `mouseup` this used to wait for alone, and the page
		 * was left in resize mode with its listeners still on the document, ready to
		 * answer the next gesture's moves.
		 */
		const onUp = () => {
			stopListening();
			if (moved) {
				handlers.onCommit(latest);
			}
		};

		document.body.addClass('layer-grid-resizing', `is-${axis}`);
		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
		document.addEventListener('mouseleave', onUp);
		window.addEventListener('blur', onUp);
		stopActiveResize = stopListening;
	});
}