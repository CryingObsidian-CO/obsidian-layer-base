/**
 * Keeps one scope on the keymap's stack at most once: the stack does not de-duplicate, and the
 * events are not balanced — `pointerdown` and `focusin` both push while leaving pops once — so
 * leftover copies go on answering the shortcut in other tabs.
 */
export interface ScopeLedger {
	acquire(): void;
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
