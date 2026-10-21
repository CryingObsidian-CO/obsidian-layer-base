import type { CellValue, Field, KanbanView, LayerRecord } from '../types';
import { emptyValueFor, formatCell, isDerived, relationIds } from './fields';

/**
 * Turning rows into the columns of a board.
 *
 * A board groups by one column, and the column may hold almost anything: a choice,
 * a number, a date, or the joined names of several linked rows. What each row
 * groups under is the text that column shows, which keeps the rule single: a row
 * sits in the column whose title matches what is written in the cell.
 */

/** How the caller resolves the display text a relation or a derived cell shows. */
export type DisplayResolver = (field: Field, record: LayerRecord) => string;

/** One column of the board. */
export interface KanbanColumn {
	/**
	 * What this column groups by, as the value to write back when a card is
	 * dropped here. `null` is the ungrouped column, which nothing can be dropped
	 * into: a row reaches it by having no value at all.
	 */
	value: CellValue | null;
	/** What the column header reads. */
	title: string;
	/** The rows in this column, in the order they were handed over. */
	recordIds: string[];
	/** Whether a card may be dropped here. */
	droppable: boolean;
	/** Rows past the limit, counted but not drawn. */
	omitted: number;
}

/** How many columns a board shows before the rest are counted and left out. */
export const DEFAULT_COLUMN_LIMIT = 50;

/** The limit a board uses, clamped to something a board can actually draw. */
export function columnLimitOf(view: KanbanView): number {
	const limit = view.columnLimit;
	if (limit === undefined || !Number.isFinite(limit)) {
		return DEFAULT_COLUMN_LIMIT;
	}
	return Math.max(1, Math.min(Math.floor(limit), 500));
}

/** The text that decides which column a row belongs to. */
function groupTextOf(
	field: Field,
	record: LayerRecord,
	resolve: DisplayResolver | undefined,
): string {
	if (field.type === 'relation' || isDerived(field.type)) {
		// These hold nothing this layer can read: a relation stores row ids and a
		// derived column stores nothing at all. The caller supplies what the grid
		// shows, so the board groups by the same text the reader sees.
		return resolve ? resolve(field, record) : '';
	}
	if (field.type === 'select') {
		// The option id names nothing; the name is what a header can read.
		const value = record.cells[field.id] ?? '';
		const name = field.options?.find((option) => option.id === value)?.name;
		// A stale id stays visible rather than pooling into `ungrouped`, which would
		// hide a value the row really holds.
		return name ?? (typeof value === 'string' ? value : '');
	}
	if (field.type === 'multiSelect') {
		// The whole selection is one group, not one group per choice: a row reading
		// `A, B` belongs to a column called that, so no row is ever in two columns.
		return formatCell(field, record.cells[field.id] ?? '');
	}
	return formatCell(field, record.cells[field.id] ?? '');
}

/**
 * The value to write when a card is dropped into a column.
 *
 * A choice column is written by id, so the column's title has to be turned back
 * into the option it names. Everything else is written as the text it shows, which
 * is what the board compares against.
 */
export function valueForColumn(field: Field, column: KanbanColumn): CellValue {
	if (column.value === null) {
		// Clearing, not writing a blank: each type has its own idea of nothing, and
		// writing `''` into a multi-select would be a value of the wrong shape.
		return emptyValueFor(field);
	}
	if (field.type === 'select') {
		const name = String(column.value);
		const option = field.options?.find(
			(candidate) => candidate.name === name,
		);
		return option ? option.id : name;
	}
	if (field.type === 'multiSelect' || field.type === 'relation') {
		// Replacing, not adding: the card ends up in exactly the column it was
		// dropped on, which is what the whole-selection grouping means.
		const name = String(column.value);
		if (field.type === 'relation') {
			return [];
		}
		const option = field.options?.find((candidate) => candidate.name === name);
		return option ? [option.id] : [];
	}
	if (field.type === 'checkbox') {
		return column.value === true;
	}
	if (field.type === 'number' || field.type === 'autoNumber') {
		const number = Number(column.value);
		return Number.isFinite(number) ? number : '';
	}
	return column.value;
}

/**
 * The values a column can hold when that set is known in advance.
 *
 * A choice has the options it was defined with and a checkbox has two states, so
 * their columns exist whether or not a row is in them — which is what lets a card
 * be dragged into one that is still empty. A text, number or date column has no
 * such set: its values are whatever the rows happen to hold, so its columns can
 * only be the ones in use.
 */
export function knownTitles(field: Field): readonly string[] {
	if (field.type === 'select') {
		return (field.options ?? []).map((option) => option.name);
	}
	if (field.type === 'multiSelect') {
		return (field.options ?? []).map((option) => option.name);
	}
	if (field.type === 'checkbox') {
		// The same two titles a ticked and an unticked cell show.
		return ['true', 'false'];
	}
	return [];
}

/**
 * The columns of a board, in the order they are drawn.
 *
 * The ungrouped column comes first and is always present, so rows that hold
 * nothing are reachable rather than silently missing from the board.
 *
 * `showEmpty` adds the columns a column *could* hold but no row uses yet: without
 * it a board of choices only offers the values already taken, so a card could
 * never be dragged into a value nobody has chosen.
 */
export function groupRecords(
	records: readonly LayerRecord[],
	field: Field,
	limit: number,
	resolve?: DisplayResolver,
	showEmpty = false,
): readonly KanbanColumn[] {
	const droppable = !isDerived(field.type);
	const groups = new Map<string, { value: CellValue; ids: string[] }>();
	const ungrouped: string[] = [];

	for (const record of records) {
		const text = groupTextOf(field, record, resolve);
		if (text.trim() === '') {
			ungrouped.push(record.id);
			continue;
		}
		// The title is the key, so two rows showing the same text share a column even
		// if they store different ids underneath.
		const key = text.trim();
		const existing = groups.get(key);
		if (existing) {
			existing.ids.push(record.id);
		} else {
			groups.set(key, { value: key, ids: [record.id] });
		}
	}

	if (showEmpty) {
		for (const title of knownTitles(field)) {
			if (!groups.has(title)) {
				groups.set(title, { value: title, ids: [] });
			}
		}
	}

	const ordered = [...groups.entries()]
		.map(([title, group]) => ({
			value: field.type === 'checkbox' ? title === 'true' : group.value,
			title,
			recordIds: group.ids,
			droppable,
			omitted: 0,
		}))
		.sort((a, b) => compareTitles(field, a.title, b.title));

	const columns: KanbanColumn[] = [
		{
			value: null,
			title: '',
			recordIds: ungrouped,
			// Dropping here clears the column, which is a real thing to want: a card
			// dragged out of a status should be able to end up with none.
			droppable,
			omitted: 0,
		},
		...ordered,
	];

	// The limit counts what is drawn; a board with more distinct values than that
	// says how many it left out rather than pretending they do not exist.
	return columns.slice(0, Math.max(1, limit));
}

/**
 * The order columns are drawn in.
 *
 * Options keep the order the column was defined in, because that order is a choice
 * the reader made. Numbers and dates sort by value, and everything else sorts as
 * text — so a board of dates reads as a calendar rather than as an accident.
 */
function compareTitles(field: Field, a: string, b: string): number {
	if (field.type === 'select') {
		const indexOf = (title: string): number => {
			const position = field.options?.findIndex(
				(option) => option.name === title,
			);
			return position === undefined || position < 0 ? Number.MAX_SAFE_INTEGER : position;
		};
		return indexOf(a) - indexOf(b);
	}
	if (field.type === 'number' || field.type === 'autoNumber') {
		return Number(a) - Number(b);
	}
	if (field.type === 'checkbox') {
		return a === 'true' ? 1 : b === 'true' ? -1 : 0;
	}
	return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** How many rows a board shows, counting what the limit left out. */
export function hiddenByLimit(
	columns: readonly KanbanColumn[],
	totalColumns: number,
): number {
	return Math.max(0, totalColumns - columns.length);
}

/** The rows of a relation cell, as ids — used when a board groups by relation. */
export function relationCellIds(value: CellValue): readonly string[] {
	return relationIds(value);
}

/** Which column titles a card, and which ones are printed under it. */
export interface CardColumns {
	title: Field | undefined;
	shown: readonly Field[];
}

/**
 * The columns a card uses, from the board's own settings.
 *
 * The title is the column the board names, falling back to the table's primary
 * column so a board that was never configured still shows something. The grouping
 * column is left out of the printed list even if it was ticked, because it is
 * already the board's structure — printing it on every card says nothing.
 */
export function cardColumnsFor(
	fields: readonly Field[],
	view: KanbanView,
): CardColumns {
	const title =
		fields.find((field) => field.id === view.titleFieldId) ??
		fields.find((field) => field.primary) ??
		fields[0];
	// Follows the table order, not the order the boxes were ticked: a card that
	// rearranged itself as fields were added would be hard to read.
	const wanted = new Set(view.cardFieldIds);
	const shown = fields.filter(
		(field) => wanted.has(field.id) && field.id !== view.groupByFieldId,
	);
	return { title, shown };
}