import { describe, expect, it } from 'vitest';
import { History, HISTORY_LIMIT, type Snapshot } from '../src/model/history';
import { createEmptyDoc } from '../src/io/schema';
import type { CellValue, Field, LayerDoc, LayerRecord } from '../src/types';

const a: Field = { id: 'f_a', name: 'A', type: 'text' };

function board(cells?: CellValue): LayerDoc {
	const doc = createEmptyDoc('Board');
	doc.fields = [{ ...a }];
	const record: LayerRecord = {
		id: 'r1',
		created: '2026-01-01T00:00:00.000Z',
		cells: cells === undefined ? {} : { f_a: cells },
	};
	doc.records = [record];
	return doc;
}

/** The merge window is time-based, so the tests drive the clock. */
function fakeClock(start = 1000): { now: () => number; tick: (by: number) => void } {
	let at = start;
	return {
		now: () => at,
		tick: (by: number) => {
			at += by;
		},
	};
}

function dataOf(doc: LayerDoc): Snapshot {
	return {
		fields: JSON.parse(JSON.stringify(doc.fields)) as Field[],
		records: JSON.parse(JSON.stringify(doc.records)) as LayerRecord[],
	};
}

describe('taking a step back', () => {
	it('answers nothing when there is nothing to undo', () => {
		const history = new History();
		expect(history.canUndo).toBe(false);
		expect(history.undo(dataOf(board()))).toBeNull();
	});

	it('gives back the state recorded before the edit', () => {
		const doc = board('one');
		const history = new History();
		history.record('cell', doc);

		// The edit happens after the record, as in the view.
		doc.records[0]!.cells.f_a = 'two';

		expect(history.canUndo).toBe(true);
		const restored = history.undo(dataOf(doc));
		expect(restored?.records[0]?.cells.f_a).toBe('one');
	});

	it('keeps the columns alongside the rows', () => {
		const doc = board('one');
		const history = new History();
		history.record('cell', doc);
		doc.fields = [];

		const restored = history.undo(dataOf(doc));
		expect(restored?.fields.map((field) => field.id)).toEqual([a.id]);
	});

	it('walks back several steps in order', () => {
		const doc = board('one');
		const clock = fakeClock();
		const history = new History(HISTORY_LIMIT, clock.now);

		history.record('cell', doc);
		// Each edit is a step of its own, so the clock has to leave the merge window.
		clock.tick(2000);
		history.record('delete', doc);
		clock.tick(2000);
		history.record('delete', doc);

		doc.records[0]!.cells.f_a = 'three';

		const first = history.undo(dataOf(doc));
		expect(first?.records[0]?.cells.f_a).toBe('one');
		expect(history.depth).toBe(2);
	});
});

describe('going forward again', () => {
	it('answers nothing when nothing was undone', () => {
		const history = new History();
		expect(history.canRedo).toBe(false);
		expect(history.redo(dataOf(board()))).toBeNull();
	});

	it('puts back the state that was undone', () => {
		const doc = board('one');
		const history = new History();
		history.record('cell', doc);
		doc.records[0]!.cells.f_a = 'two';

		history.undo(dataOf(doc));
		const forward = history.redo(dataOf(doc));
		expect(forward?.records[0]?.cells.f_a).toBe('two');
	});

	it('is dropped by a new edit, which starts another branch', () => {
		const doc = board('one');
		const history = new History();
		history.record('cell', doc);
		doc.records[0]!.cells.f_a = 'two';
		history.undo(dataOf(doc));

		expect(history.canRedo).toBe(true);
		history.record('other', doc);
		expect(history.canRedo).toBe(false);
	});
});

describe('a run of the same edit', () => {
	it('takes one step, not one per keystroke', () => {
		const doc = board('');
		const clock = fakeClock();
		const history = new History(HISTORY_LIMIT, clock.now);

		for (const text of ['a', 'ab', 'abc', 'abcd']) {
			history.record('cell', doc);
			doc.records[0]!.cells.f_a = text;
			clock.tick(100);
		}

		expect(history.depth).toBe(1);
		expect(history.undo(dataOf(doc))?.records[0]?.cells.f_a).toBe('');
	});

	it('starts a new step once the window has passed', () => {
		const doc = board('');
		const clock = fakeClock();
		const history = new History(HISTORY_LIMIT, clock.now);

		history.record('cell', doc);
		clock.tick(2000);
		history.record('cell', doc);

		expect(history.depth).toBe(2);
	});

	it('does not merge two different kinds of edit', () => {
		const doc = board('');
		const clock = fakeClock();
		const history = new History(HISTORY_LIMIT, clock.now);

		history.record('cell', doc);
		history.record('delete-row', doc);

		expect(history.depth).toBe(2);
	});

	it('does not merge after an undo', () => {
		const doc = board('one');
		const clock = fakeClock();
		const history = new History(HISTORY_LIMIT, clock.now);
		history.record('cell', doc);
		history.undo(dataOf(doc));

		history.record('cell', doc);
		expect(history.depth).toBe(1);
		expect(history.canRedo).toBe(false);
	});
});

describe('how far back it goes', () => {
	it('keeps the newest steps and drops the oldest', () => {
		const doc = board('');
		const clock = fakeClock();
		const history = new History(3, clock.now);

		for (let index = 0; index < 5; index += 1) {
			history.record('edit', doc);
			clock.tick(2000);
		}

		expect(history.depth).toBe(3);
	});

	it('is bounded by default', () => {
		expect(HISTORY_LIMIT).toBeGreaterThan(0);
		expect(HISTORY_LIMIT).toBeLessThanOrEqual(100);
	});
});

describe('forgetting', () => {
	it('empties both directions', () => {
		const doc = board('one');
		const history = new History();
		history.record('cell', doc);
		history.undo(dataOf(doc));

		history.clear();
		expect(history.canUndo).toBe(false);
		expect(history.canRedo).toBe(false);
	});
});

describe('what a snapshot does not carry', () => {
	it('holds no views, so a redraw cannot roll the layout back', () => {
		const doc = board('one');
		const history = new History();
		history.record('cell', doc);

		const restored = history.undo(dataOf(doc));
		expect(restored === null ? null : Object.keys(restored).sort()).toEqual([
			'fields',
			'records',
		]);
	});

	it('copies rather than sharing, so later edits cannot reach into it', () => {
		const doc = board('one');
		const history = new History();
		history.record('cell', doc);

		doc.records[0]!.cells.f_a = 'changed';
		doc.fields[0]!.name = 'renamed';

		const restored = history.undo(dataOf(doc));
		expect(restored?.records[0]?.cells.f_a).toBe('one');
		expect(restored?.fields[0]?.name).toBe('A');
	});
});

describe('the copy is taken before the edit', () => {
	it('holds the old value, not the new one', () => {
		const doc = board('one');
		const history = new History();

		// What the view does: snapshot, change, record.
		const before = history.snapshot(doc);
		doc.records[0]!.cells.f_a = 'two';
		history.push('cell', before);

		expect(history.undo(dataOf(doc))?.records[0]?.cells.f_a).toBe('one');
	});

	it('can be dropped when the edit changed nothing', () => {
		const doc = board('one');
		const history = new History();
		history.snapshot(doc);
		expect(history.canUndo).toBe(false);
	});

	it('snapshot copies rather than shares', () => {
		const doc = board('one');
		const history = new History();
		const before = history.snapshot(doc);
		doc.records[0]!.cells.f_a = 'two';

		history.push('cell', before);
		expect(history.undo(dataOf(doc))?.records[0]?.cells.f_a).toBe('one');
	});
});