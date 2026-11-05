import type { CellValue, Field, KanbanView, LayerRecord } from '../types';
import { emptyValueFor, formatCell, isDerived, relationIds } from './fields';
import { parseNumberIn, parseShownNumber } from './number';

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
	 * dropped here. `null` is the ungrouped column: dropping there is how a row
	 * ends up with no value at all.
	 *
	 * For most types this is the title, because a row sits under the text its cell
	 * shows. A relation column carries the row ids its cell held instead: its title
	 * is the names on screen, and no name can be turned back into ids — which is
	 * why an early version wrote an empty list on a drop and so unlinked the row.
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
 * into the option it names. Everything else is written as the value the column
 * carries, which is the text it shows — except a relation, whose column carries
 * the row ids themselves.
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
	if (field.type === 'multiSelect') {
		// Replacing, not adding: the card ends up in exactly the column it was
		// dropped on, which is what the whole-selection grouping means.
		const name = String(column.value);
		const option = field.options?.find((candidate) => candidate.name === name);
		return option ? [option.id] : [];
	}
	if (field.type === 'checkbox') {
		return column.value === true;
	}
	if (field.type === 'number' || field.type === 'autoNumber') {
		/*
		 * The column carries the text the cell shows, so it is read back the way a
		 * typed value would be: "42%" in a percent column is 0.42. `Number()` on that
		 * text is NaN, which wrote a blank — the drop cleared the cell instead of
		 * moving it.
		 */
		const parsed = parseNumberIn(field, String(column.value));
		return parsed === null ? '' : parsed;
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
 * The ungrouped column — the one rows with nothing in the grouping column fall into
 * — is drawn last, after the values: the first column a reader meets should be a
 * value the column really holds, not an empty heading in front of them. It appears
 * when it has rows to hold, and, like any column nobody has filled, only when the
 * board was asked to show the ones still unused.
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
			/*
			 * A relation column keeps the cell it was grouped from rather than its
			 * title: the title is the names on screen, and names cannot be turned back
			 * into row ids. The first row to land in a column decides for it, which is
			 * the same as the other types, where the first row's text is the title.
			 */
			const value: CellValue =
				field.type === 'relation' ? relationIds(record.cells[field.id] ?? '') : key;
			groups.set(key, { value, ids: [record.id] });
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

	/*
	 * The limit counts what is drawn; a board with more distinct values than that
	 * says how many it left out rather than pretending they do not exist.
	 *
	 * The "no value" column is drawn last but is not the one to drop: its cards have
	 * no other column to be in, and the board can only report how many *columns* it
	 * left out, not which — so it keeps a slot and the named ones share the rest.
	 */
	const budget = Math.max(
		1,
		Math.floor(Number.isFinite(limit) ? limit : DEFAULT_COLUMN_LIMIT),
	);
	const drawsUngrouped = ungrouped.length > 0 || showEmpty;
	const columns: KanbanColumn[] = ordered.slice(0, drawsUngrouped ? budget - 1 : budget);

	if (drawsUngrouped) {
		/*
		 * Last, and only when there is something for it to hold: an empty "no value"
		 * column is a column nobody has filled, so it follows the same rule as the
		 * other unused ones. It stays droppable either way — a card dragged out of a
		 * status has to be able to end up with none.
		 */
		columns.push({
			value: null,
			title: '',
			recordIds: ungrouped,
			droppable,
			omitted: 0,
		});
	}
	return columns;
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
		/*
		 * Compared by the number behind the title, not by `Number(title)`: a percent
		 * column's titles are "9%" and "10%", which is NaN for both — and a comparator
		 * answering NaN leaves `sort` free to keep any order at all.
		 */
		const left = parseShownNumber(a);
		const right = parseShownNumber(b);
		if (left !== null && right !== null) {
			return left - right;
		}
		return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
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