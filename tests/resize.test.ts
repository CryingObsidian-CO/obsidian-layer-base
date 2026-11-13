import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachRowResize, resizeSizeAt } from '../src/views/grid/resize';
import {
	MAX_COLUMN_WIDTH,
	MAX_ROW_HEIGHT,
	MIN_COLUMN_WIDTH,
	MIN_ROW_HEIGHT,
	clampColumnWidth,
	clampRowHeight,
} from '../src/model/layout';

const X = 500;
const Y = 300;

describe('resizeSizeAt', () => {
	it('ignores movement too small to be a drag', () => {
		expect(resizeSizeAt(180, X, X + 1, clampColumnWidth)).toBeNull();
		expect(resizeSizeAt(180, X, X - 1, clampColumnWidth)).toBeNull();
		expect(resizeSizeAt(180, X, X, clampColumnWidth)).toBeNull();
	});

	it('starts moving once the threshold is reached', () => {
		expect(resizeSizeAt(180, X, X + 2, clampColumnWidth)).toBe(182);
		expect(resizeSizeAt(180, X, X - 2, clampColumnWidth)).toBe(178);
	});

	it('measures from the size given for this gesture, not a stored one', () => {
		// Measure from the size this gesture started with: using the width captured when the grid was built snapped the column back first.
		const builtAt = 180;
		const afterFirstDrag = 260;

		const secondDrag = resizeSizeAt(
			afterFirstDrag,
			X,
			X + 10,
			clampColumnWidth,
		);

		expect(secondDrag).toBe(270);
		expect(secondDrag).not.toBe(resizeSizeAt(builtAt, X, X + 10, clampColumnWidth));
	});

	it('holds still when a second gesture does not move at all', () => {
		expect(resizeSizeAt(260, X, X, clampColumnWidth)).toBeNull();
	});

	it('keeps a drag inside the column bounds', () => {
		expect(resizeSizeAt(180, X, X + 5000, clampColumnWidth)).toBe(
			MAX_COLUMN_WIDTH,
		);
		expect(resizeSizeAt(180, X, X - 5000, clampColumnWidth)).toBe(
			MIN_COLUMN_WIDTH,
		);
	});

	it('clamps rows on the same scale', () => {
		expect(resizeSizeAt(32, Y, Y + 5000, clampRowHeight)).toBe(MAX_ROW_HEIGHT);
		expect(resizeSizeAt(32, Y, Y - 5000, clampRowHeight)).toBe(MIN_ROW_HEIGHT);
	});

	it('grows as the pointer travels further from where it went down', () => {
		expect(resizeSizeAt(180, X, X + 5, clampColumnWidth)).toBe(185);
		expect(resizeSizeAt(180, X, X + 50, clampColumnWidth)).toBe(230);
		expect(resizeSizeAt(180, X, X + 500, clampColumnWidth)).toBe(680);
	});
});

describe('the classes and listeners a resize leaves behind', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	type Listener = (event: unknown) => void;

	function fakeTarget() {
		const listeners = new Map<string, Set<Listener>>();
		return {
			addEventListener(type: string, listener: Listener): void {
				const set = listeners.get(type) ?? new Set<Listener>();
				set.add(listener);
				listeners.set(type, set);
			},
			removeEventListener(type: string, listener: Listener): void {
				listeners.get(type)?.delete(listener);
			},
			count(type: string): number {
				return listeners.get(type)?.size ?? 0;
			},
			fire(type: string, event: unknown): void {
				for (const listener of [...(listeners.get(type) ?? [])]) {
					listener(event);
				}
			},
		};
	}

	function environment() {
		const body = new Set<string>();
		const document = {
			...fakeTarget(),
			body: {
				addClass(...names: string[]): void {
					for (const name of names) {
						body.add(name);
					}
				},
				removeClass(...names: string[]): void {
					for (const name of names) {
						body.delete(name);
					}
				},
			},
		};
		const window = fakeTarget();
		vi.stubGlobal('document', document);
		vi.stubGlobal('window', window);
		return { document, window, body };
	}

	function fakeHandle() {
		const handlers = new Map<string, Listener>();
		return {
			addClass(): void {
				return;
			},
			addEventListener(type: string, listener: Listener): void {
				handlers.set(type, listener);
			},
			press(): void {
				handlers.get('mousedown')?.({
					button: 0,
					clientX: 0,
					clientY: 0,
					preventDefault: () => undefined,
					stopPropagation: () => undefined,
				});
			},
		};
	}

	const rowHandlers = (commits: number[]) => ({
		onStart: () => 24,
		onPreview: () => undefined,
		onCommit: (pixels: number) => commits.push(pixels),
	});

	it('takes the axis class off with the resizing class', () => {
		const env = environment();
		const handle = fakeHandle();
		attachRowResize(handle as unknown as HTMLElement, rowHandlers([]));

		handle.press();
		expect(env.body.has('layer-grid-resizing')).toBe(true);
		expect(env.body.has('is-row-resize')).toBe(true);

		env.document.fire('mousemove', { clientY: 40 });
		env.document.fire('mouseup', {});

		/*
		 * Left behind, the axis class outlives the drag: a later column drag then carries
		 * both classes and the row cursor wins.
		 */
		expect(env.body.has('is-row-resize')).toBe(false);
		expect(env.body.has('layer-grid-resizing')).toBe(false);
	});

	it('ends a resize whose release never arrived', () => {
		const env = environment();
		const handle = fakeHandle();
		const commits: number[] = [];
		attachRowResize(handle as unknown as HTMLElement, rowHandlers(commits));

		handle.press();
		env.document.fire('mousemove', { clientY: 40 });
		// The pointer leaves the window: no mouseup is ever sent.
		env.document.fire('mouseleave', {});

		expect(commits).toEqual([64]);
		expect(env.document.count('mousemove')).toBe(0);
		expect(env.document.count('mouseup')).toBe(0);
		expect(env.body.has('layer-grid-resizing')).toBe(false);
	});

	it('ends the resize when another pane takes the focus', () => {
		const env = environment();
		const handle = fakeHandle();
		const commits: number[] = [];
		attachRowResize(handle as unknown as HTMLElement, rowHandlers(commits));

		handle.press();
		env.document.fire('mousemove', { clientY: 40 });
		env.window.fire('blur', {});

		expect(commits).toEqual([64]);
		expect(env.document.count('mousemove')).toBe(0);
	});

	it('does not stack handlers when a press arrives mid-gesture', () => {
		const env = environment();
		const handle = fakeHandle();
		attachRowResize(handle as unknown as HTMLElement, rowHandlers([]));

		handle.press();
		handle.press();

		expect(env.document.count('mousemove')).toBe(1);
		expect(env.document.count('mouseup')).toBe(1);
		expect(env.window.count('blur')).toBe(1);
	});
});