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
		/*
		 * A gesture whose mouseup never arrived — released outside the window, focus
		 * taken by another pane — is still listening. Left alone it would answer the
		 * moves of this new gesture as well, so it is ended here first, the way a drag
		 * that is called off ends.
		 */
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

		/**
		 * Ends the gesture where it stands rather than where the pointer is: a drag
		 * that started before being abandoned also started its preview, which the view
		 * has to be told to put away.
		 */
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
