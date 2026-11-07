import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	attachRangeDrag,
	isOnScrollbarStrip,
} from '../src/views/grid/range-drag';

type AnyListener = (event: unknown) => void;

/**
 * The smallest node `cellFromEvent` will accept.
 *
 * It answers the selector lookups the module makes, so no DOM engine is needed to
 * tell a press on a cell from one on the scrollbar beside it.
 */
class FakeNode {
	dataset: Record<string, string> = {};
	private readonly closest_ = new Map<string, FakeNode | null>();

	closest(selector: string): FakeNode | null {
		return this.closest_.get(selector) ?? null;
	}

	answer(selector: string, node: FakeNode | null): this {
		this.closest_.set(selector, node);
		return this;
	}
}

function fakeCell(fieldId: string, recordId: string): FakeNode {
	const row = new FakeNode();
	row.dataset.recordId = recordId;
	const cell = new FakeNode();
	cell.dataset.fieldId = fieldId;
	cell.answer('.is-editing', null);
	cell.answer('.layer-grid-value.is-longtext', null);
	cell.answer('td[data-field-id]', cell);
	cell.answer('tr[data-record-id]', row);
	return cell;
}

/** A document and canvas that keep their listeners, so a test can count them. */
function fakeEnvironment() {
	const listeners = new Map<string, Set<AnyListener>>();
	const document = {
		addEventListener(type: string, listener: AnyListener): void {
			const set = listeners.get(type) ?? new Set<AnyListener>();
			set.add(listener);
			listeners.set(type, set);
		},
		removeEventListener(type: string, listener: AnyListener): void {
			listeners.get(type)?.delete(listener);
		},
		body: {
			addClass(): void {
				return;
			},
			removeClass(): void {
				return;
			},
		},
	};
	const canvasListeners = new Map<string, AnyListener>();
	const canvas = {
		addEventListener(type: string, listener: AnyListener): void {
			canvasListeners.set(type, listener);
		},
		removeEventListener(type: string): void {
			canvasListeners.delete(type);
		},
		contains: (): boolean => true,
	};
	return {
		document,
		canvas,
		count: (type: string): number => listeners.get(type)?.size ?? 0,
		fire: (type: string, event: unknown): void => {
			for (const listener of [...(listeners.get(type) ?? [])]) {
				listener(event);
			}
		},
		press: (event: unknown): void => {
			canvasListeners.get('mousedown')?.(event);
		},
	};
}

const press = (target: unknown, x = 0, y = 0): MouseEvent =>
	({ button: 0, clientX: x, clientY: y, target }) as unknown as MouseEvent;
const move = (target: unknown, x: number, y = 0): MouseEvent =>
	({ clientX: x, clientY: y, target }) as unknown as MouseEvent;

describe('isOnScrollbarStrip', () => {
	it('counts a press on the bar, and not one on the text beside it', () => {
		// A cell ending at x=300 whose scrollbar takes the last 12px.
		expect(isOnScrollbarStrip(300, 300, 12)).toBe(true);
		expect(isOnScrollbarStrip(288, 300, 12)).toBe(true);
		expect(isOnScrollbarStrip(287, 300, 12)).toBe(false);
	});

	it('excludes nothing when the cell does not scroll', () => {
		// No scrollbar means no strip: every part of the cell is a drag handle.
		expect(isOnScrollbarStrip(300, 300, 0)).toBe(false);
		expect(isOnScrollbarStrip(299, 300, 0)).toBe(false);
	});

	it('says nothing is a scrollbar when the measurement is nonsense', () => {
		// A negative gutter cannot happen, and if it did it must not swallow cells.
		expect(isOnScrollbarStrip(300, 300, -5)).toBe(false);
	});

	it('does not reach past the cell it was asked about', () => {
		// A point beyond the right edge is outside the cell, and must not be read
		// as this cell's scrollbar.
		expect(isOnScrollbarStrip(400, 300, 12)).toBe(false);
	});
});

describe('a range drag', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function attach(env: ReturnType<typeof fakeEnvironment>) {
		vi.stubGlobal('document', env.document);
		vi.stubGlobal('HTMLElement', FakeNode);
		const started: string[] = [];
		const ends: number[] = [];
		const handle = attachRangeDrag(env.canvas as unknown as HTMLElement, {
			onStart: (cell) => started.push(`${cell.recordId}/${cell.fieldId}`),
			onExtend: () => undefined,
			onEnd: () => ends.push(1),
		});
		return { handle, started, ends };
	}

	it('leaves Escape alone until the drag has actually begun', () => {
		const env = fakeEnvironment();
		const { handle, ends } = attach(env);
		const preventDefault = vi.fn();

		// A press that never leaves its cell, plus an Escape press.
		env.press(press(fakeCell('f_a', 'r1')));
		env.fire('keydown', { key: 'Escape', preventDefault });

		// Nothing of the drag's has run, so nothing of the drag's is ended: an
		// `onEnd` here would answer an `onStart` that never came.
		expect(ends).toEqual([]);
		// And the Escape was not ours to swallow — a modal listening for it still
		// receives an unprevented press.
		expect(preventDefault).not.toHaveBeenCalled();
		// The press is still live, so its own release is what ends it.
		expect(env.count('keydown')).toBe(1);
		expect(env.count('mousemove')).toBe(1);

		env.fire('mouseup', {});
		expect(env.count('keydown')).toBe(0);
		// A plain click on a cell is a choice of that cell, and stays one.
		expect(handle.consumeStaleClick()).toBe(false);

		handle.teardown();
	});

	it('ends a running drag once, and marks the release that follows stale', () => {
		const env = fakeEnvironment();
		const { handle, started, ends } = attach(env);
		const preventDefault = vi.fn();
		const from = fakeCell('f_a', 'r1');
		const to = fakeCell('f_c', 'r3');

		env.press(press(from));
		env.fire('mousemove', move(to, 60));
		expect(started).toEqual(['r1/f_a']);

		env.fire('keydown', { key: 'Escape', preventDefault });
		expect(ends).toEqual([1]);
		expect(preventDefault).toHaveBeenCalledTimes(1);
		// Escape took the listeners with it; the release below has nothing to run.
		expect(env.count('mousemove')).toBe(0);
		expect(env.count('keydown')).toBe(0);

		// The release still produces a click, and it belongs to the cancelled press:
		// without this flag it would reselect a single cell right after cancelling.
		env.fire('mouseup', {});
		expect(handle.consumeStaleClick()).toBe(true);
		expect(handle.consumeStaleClick()).toBe(false);

		handle.teardown();
	});

	it('still marks an ordinary drag release stale', () => {
		const env = fakeEnvironment();
		const { handle, started, ends } = attach(env);
		const from = fakeCell('f_a', 'r1');
		const to = fakeCell('f_c', 'r3');

		env.press(press(from));
		env.fire('mousemove', move(to, 60));
		env.fire('mouseup', move(to, 60));

		expect(started).toEqual(['r1/f_a']);
		expect(ends).toEqual([1]);
		expect(handle.consumeStaleClick()).toBe(true);

		handle.teardown();
	});
});
