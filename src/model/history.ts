import type { Field, LayerDoc, LayerRecord } from '../types';

/**
 * Undo and redo for a table's data only: views are not snapshotted, so undoing a deleted
 * row does not also undo the column the reader widened meanwhile.
 */

export interface HistoryEntry {
	label: string;
	fields: Field[];
	records: LayerRecord[];
}

export interface Snapshot {
	fields: Field[];
	records: LayerRecord[];
}

export const HISTORY_LIMIT = 30;

const MERGE_WINDOW_MS = 800;

/** Through JSON, not `structuredClone`: the document is plain JSON and older runtimes lack it. */
function copyData(doc: LayerDoc): Snapshot {
	return JSON.parse(JSON.stringify({ fields: doc.fields, records: doc.records })) as Snapshot;
}

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

	/** Call before the edit: the step holds the state to go back to. */
	record(label: string, doc: LayerDoc): void {
		this.push(label, this.snapshot(doc));
	}

	/** Take this before an edit and `push` it after: an edit that changed nothing then leaves no step. */
	snapshot(doc: LayerDoc): Snapshot {
		return copyData(doc);
	}

	/** Records a snapshot taken earlier; same-label edits inside the merge window fold into one step. */
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

	get depth(): number {
		return this.undoStack.length;
	}

	/** Used when the file is replaced: history from the old document must not replay onto a new one. */
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
