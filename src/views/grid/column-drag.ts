/**
 * Dragging a column header to reorder columns.
 *
 * The header already carries several gestures — click selects the column, double
 * click edits the field, and the trailing strip resizes it — so this one is
 * distinguished by *movement*. A press that never travels far enough is left
 * alone and the click proceeds normally; only a real drag reorders anything.
 *
 * The caller must also ignore the click the browser fires at the end of a drag.
 * That cannot be suppressed here: `stopPropagation` does not stop other
 * listeners on the same element, so the header's own click handler would still
 * select the column the user had just moved. The module reports the drag through
 * `onDrop`, and the caller uses that to ignore the following click.
 */

/** How far the pointer must travel before a press counts as a drag. */
const DRAG_THRESHOLD_PX = 4;

export interface ColumnDragCallbacks {
	/** A drag has begun; the caller can mark the dragged header. */
	onStart(fieldId: string): void;
	/** The pointer moved during the drag. */
	onMove(fieldId: string, clientX: number): void;
	/** Released after a real drag: reorder and clear the highlight. */
	onDrop(fieldId: string, clientX: number): void;
	/** The press ended as a click, or Escape cancelled the drag. */
	onCancel(): void;
}

/**
 * Wires the drag onto one header.
 *
 * Returns a teardown, so a re-render can detach a drag still listening on an
 * element that is about to be replaced.
 */
export function attachColumnDrag(
	handle: HTMLElement,
	fieldId: string,
	callbacks: ColumnDragCallbacks,
): () => void {
	let stopActiveDrag: (() => void) | null = null;

	const onMouseDown = (event: MouseEvent) => {
		// Left button only; a right-click belongs to the context menu.
		if (event.button !== 0) {
			return;
		}
		// Nothing is prevented here on purpose: this may still turn out to be a
		// click, and cancelling it would break selecting a column.
		const startX = event.clientX;
		const startY = event.clientY;
		let dragging = false;

		const stopListening = () => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
			document.removeEventListener('keydown', onKey, true);
			document.body.removeClass('layer-grid-dragging-column');
			stopActiveDrag = null;
		};

		const onMove = (move: MouseEvent) => {
			if (!dragging) {
				const travelled =
					Math.abs(move.clientX - startX) + Math.abs(move.clientY - startY);
				if (travelled < DRAG_THRESHOLD_PX) {
					return;
				}
				dragging = true;
				document.body.addClass('layer-grid-dragging-column');
				callbacks.onStart(fieldId);
			}
			callbacks.onMove(fieldId, move.clientX);
		};

		const onUp = (up: MouseEvent) => {
			const x = up.clientX;
			stopListening();
			if (dragging) {
				callbacks.onDrop(fieldId, x);
			} else {
				// Never moved: the click handler does its usual job.
				callbacks.onCancel();
			}
		};

		const onKey = (key: KeyboardEvent) => {
			if (key.key !== 'Escape' || !dragging) {
				return;
			}
			key.preventDefault();
			stopListening();
			callbacks.onCancel();
		};

		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
		document.addEventListener('keydown', onKey, true);
		stopActiveDrag = stopListening;
	};

	handle.addEventListener('mousedown', onMouseDown);
	handle.addClass('is-draggable-column');

	return () => {
		handle.removeEventListener('mousedown', onMouseDown);
		handle.removeClass('is-draggable-column');
		stopActiveDrag?.();
	};
}
