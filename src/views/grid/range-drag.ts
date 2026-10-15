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
