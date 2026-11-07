const DRAG_THRESHOLD_PX = 4;

export interface CellPointer {
	recordId: string;
	fieldId: string;
}

export interface RangeDragCallbacks {
	onStart(cell: CellPointer): void;
	onExtend(cell: CellPointer): void;
	onEnd(): void;
}

export function cellFromEvent(
	event: Event,
	canvas: HTMLElement,
): CellPointer | null {
	const target = event.target;
	if (!(target instanceof HTMLElement)) {
		return null;
	}
	const cell = target.closest<HTMLElement>('td[data-field-id]');
	if (!cell || !canvas.contains(cell)) {
		return null;
	}
	const fieldId = cell.dataset.fieldId;
	const row = cell.closest<HTMLElement>('tr[data-record-id]');
	const recordId = row?.dataset.recordId;
	if (!fieldId || !recordId) {
		return null;
	}
	return { recordId, fieldId };
}

/**
 * Whether a pointer sits on a scrollbar of the given width.
 *
 * Pure, so the rule is testable without a layout engine. A gutter of 0 means the
 * cell does not scroll, so no part of it is a scrollbar; both edges are checked
 * so a point outside the cell is never one either.
 */
export function isOnScrollbarStrip(
	clientX: number,
	right: number,
	gutter: number,
): boolean {
	if (gutter <= 0) {
		return false;
	}
	return clientX >= right - gutter && clientX <= right;
}

/**
 * Whether a press landed on the scrollbar of a cell that scrolls on its own.
 *
 * A scrolling cell's scrollbar belongs to the element and is painted by it, so a
 * press on the bar arrives as a press on the element: dragging it would scroll
 * the cell AND start a range. `offsetWidth` counts the scrollbar and `clientWidth`
 * leaves it out, so the difference is the room it takes.
 */
function onScrollbar(event: MouseEvent, target: HTMLElement): boolean {
	const scroller = target.closest<HTMLElement>(
		'.layer-grid-value.is-longtext',
	);
	if (!scroller) {
		return false;
	}
	const gutter = scroller.offsetWidth - scroller.clientWidth;
	const right = scroller.getBoundingClientRect().right;
	return isOnScrollbarStrip(event.clientX, right, gutter);
}

export interface RangeDragHandle {
	consumeStaleClick(): boolean;
	teardown(): void;
}

export function attachRangeDrag(
	canvas: HTMLElement,
	callbacks: RangeDragCallbacks,
): RangeDragHandle {
	let staleClick = false;
	const state: { stop: (() => void) | null } = { stop: null };

	const onMouseDown = (event: MouseEvent) => {
		if (event.button !== 0) {
			return;
		}
		const target = event.target as HTMLElement | null;
		if (target?.closest('.is-editing')) {
			return;
		}
		if (target && onScrollbar(event, target)) {
			return;
		}
		const start = cellFromEvent(event, canvas);
		if (!start) {
			return;
		}

		const startX = event.clientX;
		const startY = event.clientY;
		let dragging = false;

		const stopListening = () => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
			document.removeEventListener('keydown', onKey, true);
			document.body.removeClass('layer-grid-dragging-range');
			state.stop = null;
		};

		const onMove = (move: MouseEvent) => {
			if (!dragging) {
				const travelled =
					Math.abs(move.clientX - startX) + Math.abs(move.clientY - startY);
				if (travelled < DRAG_THRESHOLD_PX) {
					return;
				}
				dragging = true;
				document.body.addClass('layer-grid-dragging-range');
				callbacks.onStart(start);
			}
			const over = cellFromEvent(move, canvas);
			if (over) {
				callbacks.onExtend(over);
			}
		};

		const onUp = () => {
			stopListening();
			if (dragging) {
				staleClick = true;
				callbacks.onEnd();
			}
		};

		/**
		 * Escape only has a range to cancel once one has begun.
		 *
		 * The listener sits on the document from the first press, so before the
		 * threshold there is no gesture of ours to end: calling `onEnd` then would
		 * pair it with no `onStart`, and swallowing the key's default action would
		 * take an Escape press that belonged to something else. The release after a
		 * real cancel still sends a click, but it is the cancelled press' own, not a
		 * new choice of cell, so it is marked stale and left for `consumeStaleClick`.
		 */
		const onKey = (key: KeyboardEvent) => {
			if (key.key !== 'Escape' || !dragging) {
				return;
			}
			key.preventDefault();
			stopListening();
			staleClick = true;
			callbacks.onEnd();
		};

		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
		document.addEventListener('keydown', onKey, true);
		state.stop = stopListening;
	};

	canvas.addEventListener('mousedown', onMouseDown);

	return {
		consumeStaleClick: () => {
			const was = staleClick;
			staleClick = false;
			return was;
		},
		teardown: () => {
			canvas.removeEventListener('mousedown', onMouseDown);
			state.stop?.();
		},
	};
}
