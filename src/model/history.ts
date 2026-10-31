import type { Field, LayerDoc, LayerRecord } from '../types';

/**
 * Undo and redo for the data of a table.
 *
 * A snapshot is the fields and the rows, and nothing else. Views — column widths,
 * filters, which columns are hidden — are not part of it: undoing a deleted row
 * should put the row back, not also undo the column the reader widened meanwhile.
 */

/** One step of history: what the table held before an edit. */
export interface HistoryEntry {
	/** What the edit was, used to merge a run of the same kind of edit. */
	label: string;
	fields: Field[];
	records: LayerRecord[];
}

/** The data of a document, as a snapshot holds it. */
export interface Snapshot {
	fields: Field[];
	records: LayerRecord[];
}

/** How many steps back a table may go. */
export const HISTORY_LIMIT = 30;

/** How long a run of the same edit keeps merging into one step. */
const MERGE_WINDOW_MS = 800;

/**
 * Copies the data of a document.
 *
 * Through JSON rather than `structuredClone`: the document is plain JSON by
 * construction, and this way a runtime without the newer function still works.
 */
function copyData(doc: LayerDoc): Snapshot {
	return JSON.parse(JSON.stringify({ fields: doc.fields, records: doc.records })) as Snapshot;
}

/** Reads a clock, given a chance to be replaced in tests. */
export type Clock = () => number;

export class History {
	private undoStack: HistoryEntry[] = [];
	private redoStack: HistoryEntry[] = [];
	private lastLabel = '';
	private lastAt = 0;

	constructor(
		private readonly limit: number = HISTORY_LIMIT,
		private readonly now: Clock = () => Date.now(),
	) {}

	/**
	 * Records what the table looked like before an edit.
	 *
	 * Called *before* the change is made, so a step holds the state to go back to. A
	 * run of the same kind of edit within the merge window replaces the step it would
	 * otherwise follow: typing in one cell should take one press to undo, not one per
	 * keystroke.
	 */
	record(label: string, doc: LayerDoc): void {
		this.push(label, this.snapshot(doc));
	}

	/**
	 * Copies the data now, before an edit is made.
	 *
	 * Paired with `push`: an edit that turns out to change nothing — a delete that
	 * matched no rows — can then leave no step behind.
	 */
	snapshot(doc: LayerDoc): Snapshot {
		return copyData(doc);
	}

	/**
	 * Records a snapshot taken earlier.
	 *
	 * Called after the edit, handing back what `snapshot` took before it. A run of the
	 * same kind of edit within the merge window replaces the step it would otherwise
	 * follow: typing in one cell should take one press to undo, not one per keystroke.
	 */
	push(label: string, before: Snapshot): void {
		const at = this.now();
		const merging =
			this.undoStack.length > 0 &&
			label === this.lastLabel &&
			at - this.lastAt <= MERGE_WINDOW_MS;

		if (!merging) {
			this.undoStack.push({ label, ...before });
			if (this.undoStack.length > this.limit) {
				this.undoStack.shift();
			}
		}

		// Any new edit is a new branch: what could be redone no longer applies.
		this.redoStack = [];
		this.lastLabel = label;
		this.lastAt = at;
	}

	/**
	 * Takes one step back, returning the data to restore.
	 *
	 * The state handed back is the table as it was before the edit, and the caller's
	 * current state is pushed onto the redo stack so it can be reached again.
	 */
	undo(current: Snapshot): Snapshot | null {
		const entry = this.undoStack.pop();
		if (!entry) {
			return null;
		}
		this.redoStack.push({
			label: entry.label,
			fields: copyOf(current.fields),
			records: copyOf(current.records),
		});
		// A step just taken back must not merge with an edit made after it.
		this.lastLabel = '';
		this.lastAt = 0;
		return { fields: entry.fields, records: entry.records };
	}

	/** Takes one step forward again, after an undo. */
	redo(current: Snapshot): Snapshot | null {
		const entry = this.redoStack.pop();
		if (!entry) {
			return null;
		}
		this.undoStack.push({
			label: entry.label,
			fields: copyOf(current.fields),
			records: copyOf(current.records),
		});
		this.lastLabel = '';
		this.lastAt = 0;
		return { fields: entry.fields, records: entry.records };
	}

	get canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	get canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	/** How many steps back are available, for tests and for a status line. */
	get depth(): number {
		return this.undoStack.length;
	}

	/**
	 * Forgets everything.
	 *
	 * Used when the file is replaced under us: history from the old document must not
	 * be replayed onto a new one.
	 */
	clear(): void {
		this.undoStack = [];
		this.redoStack = [];
		this.lastLabel = '';
		this.lastAt = 0;
	}
}

function copyOf<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}
