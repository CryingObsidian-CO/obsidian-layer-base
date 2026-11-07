/**
 * Keeps one scope on the keymap's stack at most once.
 *
 * The stack has no de-duplication of its own, and the events that drive this are
 * not a balanced pair: a click inside the view fires `pointerdown` — and, when
 * focus arrives from outside, `focusin` as well — while focus leaving the view
 * pops once. Pushing on every one of those leaves copies behind that keep
 * answering the shortcut for every other tab, long after this view lost focus.
 *
 * So the ledger remembers whether the scope is on the stack: `acquire` pushes
 * only when it is not, and `release` pops only when it is. That also makes an
 * unload harmless — a view that was never focused has nothing to pop.
 *
 * The scope type is left to the caller, since what it is pushed into is not this
 * module's business.
 */
export interface ScopeLedger {
	/** Puts the scope on the stack unless it is already there. */
	acquire(): void;
	/** Takes the scope off the stack, if this ledger put it there. */
	release(): void;
}

export function scopeLedger<T>(
	scope: T,
	push: (scope: T) => void,
	pop: (scope: T) => void,
): ScopeLedger {
	let held = false;
	return {
		acquire(): void {
			if (held) {
				return;
			}
			held = true;
			push(scope);
		},
		release(): void {
			if (!held) {
				return;
			}
			held = false;
			pop(scope);
		},
	};
}
