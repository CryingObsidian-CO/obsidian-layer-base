/**
 * Dragging across cells to select a rectangle, as in a spreadsheet.
 *
 * The gesture is attached once to the table rather than to every cell: a board
 * with a thousand rows would otherwise carry a thousand pairs of listeners, and
 * the cells are rebuilt on every render anyway. One listener on the container
 * reads which cell a pointer event landed on from the element's dataset.
 *
 * Two phases, like the column resize: the rectangle is extended live during the
 * drag, but nothing is written to the document — a selection is not persisted, so
 * there is nothing to commit. What does need care is the *end* of the gesture: the
 * browser fires a click on the cell it started from, and that click would reset
 * the selection back to a single cell.
 */

/** How far the pointer must move before a press counts as a drag. */
const DRAG_THRESHOLD_PX = 4;

export interface CellPointer {
	recordId: string;
	fieldId: string;
}

export interface RangeDragCallbacks {
	/** A drag began on this cell, which becomes the anchor. */
	onStart(cell: CellPointer): void;
	/** The pointer is now over this cell, which becomes the focus. */
	onExtend(cell: CellPointer): void;
	/** Released. The caller decides whether the following click is stale. */
	onEnd(): void;
}

/**
 * Turns a pointer event into the cell it landed on.
 *
 * Reads the ids the renderer writes onto each cell, rather than walking up from
 * the event target looking for a class. The target may be a span, an input or an
 * SVG inside the cell, so walking up is both more code and more fragile.
 */
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

export interface RangeDragHandle {
	/** True when a drag just ended, so the click it produced should be ignored. */
	consumeStaleClick(): boolean;
	teardown(): void;
}

/**
 * Attaches the rectangle drag to the table.
 *
 * Cell editing starts on a double click, so a single press is free to begin a
 * selection. The press is not prevented: cancelling it would break focus and the
 * context menu.
 */
export function attachRangeDrag(
	canvas: HTMLElement,
	callbacks: RangeDragCallbacks,
): RangeDragHandle {
	let staleClick = false;
	/*
	 * Held in an object rather than a bare `let`: the only assignment happens
	 * inside the mousedown callback, and TypeScript's flow analysis cannot see
	 * across that boundary — it narrows a bare variable to `never` at the read
	 * site. A property is not subject to the same narrowing.
	 */
	const state: { stop: (() => void) | null } = { stop: null };

	const onMouseDown = (event: MouseEvent) => {
		// Left button only. A right-click belongs to the context menu, and a
		// middle click to the browser.
		if (event.button !== 0) {
			return;
		}
		// A press inside an open editor is for that editor.
		if ((event.target as HTMLElement | null)?.closest('.is-editing')) {
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
				// The click that follows must not collapse the rectangle back to
				// the cell the drag started on.
				staleClick = true;
				callbacks.onEnd();
			}
		};

		const onKey = (key: KeyboardEvent) => {
			if (key.key === 'Escape') {
				key.preventDefault();
				stopListening();
				callbacks.onEnd();
			}
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
