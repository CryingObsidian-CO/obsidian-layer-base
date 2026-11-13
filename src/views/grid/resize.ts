import { clampColumnWidth, clampRowHeight } from '../../model/layout';

const DRAG_THRESHOLD_PX = 2;

export interface ResizeHandlers {
	onStart(): number;
	onPreview(pixels: number): void;
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

	// A press during an in-flight gesture means the first never saw its release; dropping
	// its listeners keeps the two from moving and committing the same column.
	let stopActiveResize: (() => void) | null = null;

	handle.addEventListener('mousedown', (event) => {
		if (event.button !== 0) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		stopActiveResize?.();

		// Read per gesture: a committed resize leaves the column wider, so an attach-time
		// value is stale by the next drag.
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
			// Both go: a leftover axis class kept the cursor pointing the wrong way later.
			document.body.removeClass('layer-grid-resizing', `is-${axis}`);
			stopActiveResize = null;
		};

		/**
		 * A release outside the window, a context menu or another pane taking focus sends no
		 * `mouseup`, which would leave the listeners answering the next gesture.
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