import { describe, expect, it } from 'vitest';
import {
	placeAtAnchor,
	type Viewport,
} from '../src/ui/anchor-placement';

/** `placeAtAnchor` only ever writes `top` and `left`. */
function panel(): { style: Record<string, string> } {
	return { style: {} };
}

const rect = (over: Partial<DOMRect> = {}): DOMRect =>
	({
		top: 100,
		bottom: 140,
		left: 100,
		right: 300,
		width: 200,
		height: 40,
		...over,
	}) as DOMRect;

const TALL: Viewport = { width: 1000, height: 800 };
const SHORT: Viewport = { width: 1000, height: 400 };

const place = (
	el: { style: Record<string, string> },
	anchor: DOMRect | null,
	panelRect: DOMRect,
	viewport: Viewport,
): void => {
	placeAtAnchor(el as unknown as HTMLElement, anchor, panelRect, viewport);
};

describe('placeAtAnchor', () => {
	it('opens below the anchor where there is room', () => {
		const el = panel();

		place(el, rect(), rect({ height: 200 }), TALL);

		expect(el.style.top).toBe('148px'); // anchor.bottom 140 + margin 8
		expect(el.style.left).toBe('100px');
	});

	it('flips above the anchor when it would not fit below', () => {
		const el = panel();
		const anchor = rect({ top: 300, bottom: 340 });

		place(el, anchor, rect({ height: 200 }), SHORT);

		expect(el.style.top).toBe('92px'); // 300 - 200 - 8
	});

	it('stays below when the space above is not the larger one', () => {
		const el = panel();
		// Near the top: little room below, even less above.
		const anchor = rect({ top: 10, bottom: 50 });

		place(el, anchor, rect({ height: 200 }), SHORT);

		expect(el.style.top).toBe('58px');
	});

	it('clamps to the right edge rather than overflowing the window', () => {
		const el = panel();
		const anchor = rect({ left: 950, right: 990 });

		place(el, anchor, rect({ width: 300 }), TALL);

		expect(el.style.left).toBe('692px'); // 1000 - 300 - 8
	});

	it('never places the panel off the left edge', () => {
		const el = panel();
		const anchor = rect({ left: -50, right: -10 });

		place(el, anchor, rect({ width: 300 }), TALL);

		expect(el.style.left).toBe('8px');
	});

	it('stays at the left edge when the panel is wider than the window', () => {
		const el = panel();
		const narrow: Viewport = { width: 320, height: 800 };

		/*
		 * 360 wide in a 320 window: the cap on the right is -48, smaller than the
		 * margin. With the margin applied last the panel stays at the left edge and
		 * runs off the right; before, it slid off the left instead.
		 */
		place(
			el,
			rect({ left: 250, right: 290 }),
			rect({ width: 360, height: 200 }),
			narrow,
		);

		expect(el.style.left).toBe('8px');
	});

	it('holds a tall panel inside the window instead of drawing past the bottom', () => {
		const el = panel();

		// 700 tall in a 400 window: no side can hold it, so it starts at the margin.
		place(el, rect(), rect({ height: 700 }), SHORT);

		expect(el.style.top).toBe('8px');
	});

	it('pulls a panel back into the window when the trigger is scrolled past the end', () => {
		const el = panel();
		const anchor = rect({ top: 500, bottom: 540 });

		// The trigger is off the bottom of a 400-high window; the panel still lands
		// where its own height allows: 400 - 200 - 8.
		place(el, anchor, rect({ height: 200 }), SHORT);

		expect(el.style.top).toBe('192px');
	});

	it('counts the margin as room it cannot use when choosing a side', () => {
		const el = panel();
		// 53 tall with 52 usable below (60 raw, less the margin) and plenty above.
		const anchor = rect({ top: 300, bottom: 340 });

		place(el, anchor, rect({ height: 53 }), SHORT);

		// Below would clip a pixel off the bottom, so it opens above instead.
		expect(el.style.top).toBe('239px'); // 300 - 53 - 8
	});

	it('leaves the panel untouched when there is no anchor', () => {
		const el = panel();

		place(el, null, rect(), TALL);

		expect(el.style).toEqual({});
	});
});