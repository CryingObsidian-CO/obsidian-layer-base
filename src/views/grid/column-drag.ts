const DRAG_THRESHOLD_PX = 4;

export interface ColumnDragCallbacks {
	onStart(fieldId: string): void;
	onMove(fieldId: string, clientX: number): void;
	onDrop(fieldId: string, clientX: number): void;
	onCancel(): void;
}

export function attachColumnDrag(
	handle: HTMLElement,
	fieldId: string,
	callbacks: ColumnDragCallbacks,
): () => void {
	let stopActiveDrag: (() => void) | null = null;

	const onMouseDown = (event: MouseEvent) => {
		if (event.button !== 0) {
			return;
		}
		// A gesture that never saw its mouseup — released outside the window, focus taken by
		// another pane — is still listening and would answer this gesture's moves as well.
		stopActiveDrag?.();

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

		/** Ends without a position, so the view puts its preview away instead of dropping. */
		const abandon = () => {
			const wasDragging = dragging;
			stopListening();
			if (wasDragging) {
				callbacks.onCancel();
			}
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
		stopActiveDrag = abandon;
	};

	handle.addEventListener('mousedown', onMouseDown);
	handle.addClass('is-draggable-column');

	return () => {
		handle.removeEventListener('mousedown', onMouseDown);
		handle.removeClass('is-draggable-column');
		stopActiveDrag?.();
	};
}
