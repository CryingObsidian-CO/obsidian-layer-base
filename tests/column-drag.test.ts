import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachColumnDrag } from '../src/views/grid/column-drag';

type Listener = (event: MouseEvent) => void;

/** A document that keeps its listeners in a list, so a test can count them. */
function fakeDocument() {
	const listeners = new Map<string, Set<Listener>>();
	const classes = new Set<string>();
	const document = {
		addEventListener(type: string, listener: Listener): void {
			const set = listeners.get(type) ?? new Set<Listener>();
			set.add(listener);
			listeners.set(type, set);
		},
		removeEventListener(type: string, listener: Listener): void {
			listeners.get(type)?.delete(listener);
		},
		body: {
			addClass(name: string): void {
				classes.add(name);
			},
			removeClass(name: string): void {
				classes.delete(name);
			},
		},
	};
	return {
		document,
		classes,
		count: (type: string): number => listeners.get(type)?.size ?? 0,
		fire: (type: string, event: MouseEvent): void => {
			for (const listener of [...(listeners.get(type) ?? [])]) {
				listener(event);
			}
		},
	};
}

function fakeHandle() {
	const handlers = new Map<string, Listener>();
	return {
		addEventListener(type: string, listener: Listener): void {
			handlers.set(type, listener);
		},
		removeEventListener(type: string): void {
			handlers.delete(type);
		},
		addClass(): void {
			return;
		},
		removeClass(): void {
			return;
		},
		press(event: MouseEvent): void {
			handlers.get('mousedown')?.(event);
		},
	};
}

const press = (x: number, y: number): MouseEvent =>
	({ button: 0, clientX: x, clientY: y }) as unknown as MouseEvent;
const move = (x: number, y: number): MouseEvent =>
	({ clientX: x, clientY: y }) as unknown as MouseEvent;

describe('a column drag', () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('ends a gesture whose mouseup never came before starting the next', () => {
		const env = fakeDocument();
		vi.stubGlobal('document', env.document);
		const handle = fakeHandle();
		const moves: number[] = [];
		let cancels = 0;

		const detach = attachColumnDrag(handle as unknown as HTMLElement, 'f_a', {
			onStart: () => undefined,
			onMove: (_fieldId, clientX) => moves.push(clientX),
			onDrop: () => undefined,
			onCancel: () => {
				cancels += 1;
			},
		});

		// A first press that drags, and then never sees its mouseup.
		handle.press(press(0, 0));
		env.fire('mousemove', move(40, 0));
		expect(moves).toEqual([40]);

		// A second press while the first is still listening.
		handle.press(press(0, 0));
		env.fire('mousemove', move(50, 0));

		/*
		 * One listener means one move per event: left alone, the older gesture answered
		 * as well, so one pointer move reported twice and the abandoned drag kept its
		 * preview.
		 */
		expect(env.count('mousemove')).toBe(1);
		expect(moves).toEqual([40, 50]);
		expect(cancels).toBe(1);

		detach();
	});
});
