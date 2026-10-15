import { clampColumnWidth, clampRowHeight } from '../../model/layout';

const DRAG_THRESHOLD_PX = 2;

export interface ResizeHandlers {
	onPreview(pixels: number): void;
	onCommit(pixels: number): void;
}

export function attachColumnResize(
	handle: HTMLElement,
	startWidth: number,
	handlers: ResizeHandlers,
): void {
	attachResize(handle, 'col-resize', startWidth, clampColumnWidth, handlers);
}

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
	handle.addEventListener('click', (event) => event.stopPropagation());
	handle.addEventListener('dblclick', (event) => event.stopPropagation());

	handle.addEventListener('mousedown', (event) => {
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
			if (moved) {
				handlers.onCommit(latest);
			}
		};

		document.body.addClass('layer-grid-resizing', `is-${axis}`);
		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
	});
}
