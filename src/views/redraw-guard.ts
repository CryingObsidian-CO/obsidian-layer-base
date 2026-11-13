/**
 * Commits the open editor before drawing — its text lives in the DOM a redraw tears down — and
 * a commit redraws, so the nested call returns rather than drawing the same state twice.
 */
export function redrawOnce(
	state: { busy: boolean },
	commitOpenEdit: () => void,
	draw: () => void,
): void {
	if (state.busy) {
		return;
	}
	state.busy = true;
	try {
		commitOpenEdit();
		draw();
	} finally {
		// A flag stuck by a throw would refuse every later redraw.
		state.busy = false;
	}
}
