import { describe, expect, it, vi } from 'vitest';

/*
 * The panel editors are not exercised here: they need a live document and offer
 * nothing this test is about. What matters is that every way an edit can end
 * reports completion exactly once, and each of those ways below is one of the
 * plain inputs (Enter, Escape, blur). The option panel is captured so the one
 * test about it can drive its callbacks.
 */
const panels = vi.hoisted(() => ({
	option: null as null | {
		onPickMany?: (optionIds: string[]) => void;
		onCancel: () => void;
	},
}));

vi.mock('../src/ui/option-dropdown', () => ({
	openOptionDropdown: (config: unknown) => {
		panels.option = config as typeof panels.option;
		return { close: () => undefined };
	},
}));
vi.mock('../src/ui/relation-dropdown', () => ({
	openRelationDropdown: () => ({ close: () => undefined }),
}));

import { beginCellEdit } from '../src/views/grid/cell-editor';
import type { CellValue, Field, SelectOption } from '../src/types';

class FakeInput {
	type = '';
	private stored = '';
	private readonly listeners = new Map<string, Set<(event: unknown) => void>>();

	/**
	 * Mirrors a native control: a value it cannot represent is dropped to the
	 * empty string, which is exactly the trap the date editor has to notice.
	 */
	set value(text: string) {
		this.stored = this.represents(text) ? text : '';
	}

	get value(): string {
		return this.stored;
	}

	private represents(text: string): boolean {
		if (this.type === 'date') {
			// HTML wants a four-digit year greater than 0.
			return /^\d{4}-\d{2}-\d{2}$/.test(text) && !text.startsWith('0000');
		}
		if (this.type === 'datetime-local') {
			return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(text) && !text.startsWith('0000');
		}
		return true;
	}

	focus(): void {
		return;
	}

	select(): void {
		return;
	}

	addEventListener(type: string, listener: (event: unknown) => void): void {
		const set = this.listeners.get(type) ?? new Set();
		set.add(listener);
		this.listeners.set(type, set);
	}

	fire(type: string, event: unknown): void {
		for (const listener of [...(this.listeners.get(type) ?? [])]) {
			listener(event);
		}
	}
}

class FakeCell {
	readonly classes = new Set<string>();
	created: FakeInput[] = [];

	addClass(name: string): void {
		this.classes.add(name);
	}

	removeClass(name: string): void {
		this.classes.delete(name);
	}

	hasClass(name: string): boolean {
		return this.classes.has(name);
	}

	empty(): void {
		this.created = [];
	}

	createEl(): FakeInput {
		const input = new FakeInput();
		this.created.push(input);
		return input;
	}
}

const textField: Field = { id: 'f_a', name: 'A', type: 'text' };

const key = (name: string): KeyboardEvent =>
	({
		key: name,
		ctrlKey: false,
		metaKey: false,
		preventDefault: () => undefined,
		stopPropagation: () => undefined,
	}) as unknown as KeyboardEvent;

interface Tracked {
	cell: FakeCell;
	input: FakeInput;
	commits: CellValue[];
	restores: number;
	finished: number;
}

function openText(): Tracked {
	const cell = new FakeCell();
	const tracked: Tracked = {
		cell,
		input: new FakeInput(),
		commits: [],
		restores: 0,
		finished: 0,
	};
	beginCellEdit(cell as unknown as HTMLElement, {
		field: textField,
		value: 'old',
		commit: (next) => tracked.commits.push(next),
		restore: () => {
			tracked.restores += 1;
		},
		createOption: (): SelectOption | null => null,
		onFinished: () => {
			tracked.finished += 1;
		},
	});
	const [input] = cell.created;
	if (!input) {
		throw new Error('the text editor did not create an input');
	}
	tracked.input = input;
	input.value = 'typed';
	return tracked;
}

describe('a cell edit ending', () => {
	it('reports completion once on blur, and commits what was typed', () => {
		const t = openText();
		expect(t.cell.hasClass('is-editing')).toBe(true);

		t.input.fire('blur', {});

		expect(t.finished).toBe(1);
		expect(t.commits).toEqual(['typed']);
		expect(t.restores).toBe(1);
		expect(t.cell.hasClass('is-editing')).toBe(false);
	});

	it('reports completion once on Escape, without committing', () => {
		const t = openText();

		t.input.fire('keydown', key('Escape'));

		expect(t.finished).toBe(1);
		expect(t.commits).toEqual([]);
		expect(t.cell.hasClass('is-editing')).toBe(false);
	});

	it('reports completion once on Enter, and commits', () => {
		const t = openText();

		t.input.fire('keydown', key('Enter'));

		expect(t.finished).toBe(1);
		expect(t.commits).toEqual(['typed']);
	});

	it('does not report twice when a second end arrives', () => {
		// blur ends the edit; the Escape that follows has nothing left to end.
		const t = openText();
		t.input.fire('blur', {});
		t.input.fire('keydown', key('Escape'));
		t.input.fire('blur', {});

		expect(t.finished).toBe(1);
		expect(t.commits).toEqual(['typed']);
	});

	it('lets a caller drop its handle from the completion notice', () => {
		const cell = new FakeCell();
		let handle: unknown = null;
		let held: boolean | null = null;
		handle = beginCellEdit(cell as unknown as HTMLElement, {
			field: textField,
			value: '',
			commit: () => undefined,
			restore: () => undefined,
			createOption: (): SelectOption | null => null,
			onFinished: () => {
				held = handle !== null;
				handle = null;
			},
		});
		const [input] = cell.created;
		input?.fire('blur', {});

		// The notice arrives while the caller still holds the handle, and clears it.
		expect(held).toBe(true);
		expect(handle).toBeNull();
	});

	it('works with no completion notice supplied', () => {
		const cell = new FakeCell();
		beginCellEdit(cell as unknown as HTMLElement, {
			field: textField,
			value: '',
			commit: () => undefined,
			restore: () => undefined,
			createOption: (): SelectOption | null => null,
		});
		expect(() => cell.created[0]?.fire('blur', {})).not.toThrow();
		expect(cell.hasClass('is-editing')).toBe(false);
	});
});

describe('a date edit the control cannot show', () => {
	const dateField: Field = { id: 'f_d', name: 'D', type: 'date' };

	function openDate(value: CellValue) {
		const cell = new FakeCell();
		const commits: CellValue[] = [];
		let restores = 0;
		let finished = 0;
		const handle = beginCellEdit(cell as unknown as HTMLElement, {
			field: dateField,
			value,
			commit: (next) => commits.push(next),
			restore: () => {
				restores += 1;
			},
			createOption: (): SelectOption | null => null,
			onFinished: () => {
				finished += 1;
			},
		});
		return { cell, handle, commits, restores, finished };
	}

	it('never writes an empty string over a value it could not represent', () => {
		// A year of 0000: the model accepts it, the native control does not.
		const t = openDate('0000-01-01');

		expect(t.handle).toBeNull();
		expect(t.commits).toEqual([]);
		expect(t.restores).toBe(1);
		expect(t.finished).toBe(1);
		expect(t.cell.hasClass('is-editing')).toBe(false);
	});

	it('opens and commits an ordinary date as before', () => {
		const t = openDate('2026-10-17');
		expect(t.handle).not.toBeNull();
		expect(t.cell.created[0]?.value).toBe('2026-10-17');

		t.cell.created[0]?.fire('blur', {});
		expect(t.commits).toEqual(['2026-10-17']);
	});
});

describe('a panel that commits while it stays open', () => {
	const multiField: Field = {
		id: 'f_m',
		name: 'M',
		type: 'multiSelect',
		options: [{ id: 'o_1', name: 'One', color: 'blue' }],
	};

	it('reports completion when it closes, not on every toggle', () => {
		const cell = new FakeCell();
		const commits: CellValue[] = [];
		let finished = 0;
		beginCellEdit(cell as unknown as HTMLElement, {
			field: multiField,
			value: [],
			commit: (next) => commits.push(next),
			restore: () => undefined,
			createOption: (): SelectOption | null => null,
			onFinished: () => {
				finished += 1;
			},
		});

		const panel = panels.option;
		expect(panel).not.toBeNull();

		// A toggle commits the cell behind the panel, which stays open: the edit is
		// not over yet, so completion must not fire here.
		panel?.onPickMany?.(['o_1']);
		expect(commits).toEqual([['o_1']]);
		expect(finished).toBe(0);

		// Closing it is what ends the edit.
		panel?.onCancel();
		expect(finished).toBe(1);
	});
});
