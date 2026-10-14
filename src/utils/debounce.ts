import type { Debouncer } from 'obsidian';

/**
 * Trailing-edge debounce that keeps the latest call's arguments and exposes a
 * `cancel` so a view can drop a pending save when it unloads.
 *
 * Used for writing `.layer` files: typing in a cell should not hit the vault on
 * every keystroke, but the last keystroke must always land. `run()` flushes a
 * pending call immediately, which is what a view calls while it is closing.
 *
 * Mirrors Obsidian's own `Debouncer` so it can be dropped into the same call
 * sites, including the 2-argument form used for writes.
 */
export function debounce<T extends unknown[], V>(
	fn: (...args: T) => V,
	timeoutMs: number,
): Debouncer<T, V> {
	let handle: number | null = null;
	let pending: T | null = null;

	function flush(): V | void {
		if (handle !== null) {
			window.clearTimeout(handle);
			handle = null;
		}
		const call = pending;
		pending = null;
		return call ? fn(...call) : undefined;
	}

	const debounced = ((...args: T) => {
		pending = args;
		if (handle !== null) {
			window.clearTimeout(handle);
		}
		handle = window.setTimeout(() => {
			handle = null;
			const call = pending;
			pending = null;
			if (call) {
				fn(...call);
			}
		}, timeoutMs);
	}) as Debouncer<T, V>;

	debounced.cancel = () => {
		if (handle !== null) {
			window.clearTimeout(handle);
			handle = null;
		}
		pending = null;
		return debounced;
	};

	debounced.run = flush;

	return debounced;
}