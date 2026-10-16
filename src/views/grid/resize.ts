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

	handle.addEventListener('mousedown', (event) => {
		if (event.button !== 0) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();

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