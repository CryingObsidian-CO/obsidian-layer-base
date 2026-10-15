import { clampColumnWidth, clampRowHeight } from '../../model/layout';

/**
 * Dragging the divider between a column's header or a row's number, as in a
 * spreadsheet.
 *
 * Two-phase on purpose: during the drag only the DOM changes, and the view is
 * written once on release. Writing the document on every pointer move would
 * dirty it dozens of times per gesture and queue that many saves for a value the
 * user is still choosing.
 *
 * The drag is also distinguished from a click. A header cell selects its column
 * when clicked, and the divider sits inside it, so a plain `stopPropagation` on
 * mousedown would be enough — but a gesture that moves is not a click, and
 * treating one as both would resize the column *and* select it. The movement
 * threshold keeps the two apart in the direction that matters.
 */

/** How far the pointer must move before the gesture counts as a drag. */
const DRAG_THRESHOLD_PX = 2;

export interface ResizeHandlers {
	/** Called continuously while dragging. `pixels` is already clamped. */
	onPreview(pixels: number): void;
	/** Called once on release with the final size. */
	onCommit(pixels: number): void;
}

/** Makes `handle` resize something horizontally, e.g. a column. */
export function attachColumnResize(
	handle: HTMLElement,
	startWidth: number,
	handlers: ResizeHandlers,
): void {
	attachResize(handle, 'col-resize', startWidth, clampColumnWidth, handlers);
}

/** Makes `handle` resize something vertically, e.g. a row. */
export function attachRowResize(
	handle: HTMLElement,
	startHeight: number,
	handlers: ResizeHandlers,
): void {
	attachResize(handle, 'row-resize', startHeight, clampRowHeight, handlers);
}

function attachResize(
	handle: HTMLElement,
	axis: 'col-resize' | 'row-resize',
	startSize: number,
	clamp: (value: number) => number,
	handlers: ResizeHandlers,
): void {
	handle.addClass('layer-grid-resize', `is-${axis}`);
	// The gesture belongs to the handle, not to the header cell underneath it,
	// which would otherwise select the column when the drag ends.
	handle.addEventListener('click', (event) => event.stopPropagation());
	handle.addEventListener('dblclick', (event) => event.stopPropagation());

	handle.addEventListener('mousedown', (event) => {
		// Left button only; a right-click here belongs to the context menu.
		if (event.button !== 0) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();

		const startPointer = axis === 'col-resize' ? event.clientX : event.clientY;
		let moved = false;
		let latest = startSize;

		const onMove = (move: MouseEvent) => {
			const pointer =
				axis === 'col-resize' ? move.clientX : move.clientY;
			const delta = pointer - startPointer;
			if (!moved && Math.abs(delta) < DRAG_THRESHOLD_PX) {
				return;
			}
			moved = true;
			latest = clamp(startSize + delta);
			handlers.onPreview(latest);
		};

		const onUp = () => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
			document.body.removeClass('layer-grid-resizing');
			// A gesture that never moved was a click; leave the size alone.
			if (moved) {
				handlers.onCommit(latest);
			}
		};

		document.body.addClass('layer-grid-resizing', `is-${axis}`);
		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
	});
}
