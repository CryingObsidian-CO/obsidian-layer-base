/**
 * A redraw that ends an open editor first, and runs only once even if the commit
 * asks for a redraw of its own.
 *
 * A cell editor's text lives in the DOM until it is committed, and a redraw tears
 * that DOM down — so the edit has to be committed before drawing or whatever the
 * reader typed is thrown away. But committing is itself an edit to the document,
 * and the view redraws after an edit, so `commitOpenEdit` can call back into the
 * redraw. `state.busy` makes that inner call a no-op: the pass already under way
 * draws the committed state, so the view is drawn once rather than twice.
 *
 * `state` is owned by the caller and kept for the life of the view, so the guard
 * spans the nested calls rather than one invocation.
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
		// Cleared even if drawing throws: a stuck flag would refuse every later
		// redraw, and the next one should be tried.
		state.busy = false;
	}
}
