import type { CellValue, Field, KanbanView, LayerRecord } from '../types';
import { emptyValueFor, formatCell, isDerived, relationIds } from './fields';
import { parseNumberIn, parseShownNumber } from './number';

/** A row sits in the column whose title matches the text its grouping cell shows. */

export type DisplayResolver = (field: Field, record: LayerRecord) => string;

export interface KanbanColumn {
	/**
	 * What to write back on a drop; `null` is the ungrouped column. A relation carries the
	 * row ids its cell held, not its title: a name cannot be turned back into ids.
	 */
	value: CellValue | null;
	title: string;
	recordIds: string[];
	droppable: boolean;
	omitted: number;
}

/** How many columns a board shows before the rest are counted and left out. */
export const DEFAULT_COLUMN_LIMIT = 50;

export function columnLimitOf(view: KanbanView): number {
	const limit = view.columnLimit;
	if (limit === undefined || !Number.isFinite(limit)) {
		return DEFAULT_COLUMN_LIMIT;
	}
	return Math.max(1, Math.min(Math.floor(limit), 500));
}

function groupTextOf(
	field: Field,
	record: LayerRecord,
	resolve: DisplayResolver | undefined,
): string {
	if (field.type === 'relation' || isDerived(field.type)) {
		// A relation stores row ids and a derived column stores nothing, so the caller supplies the text the grid shows.
		return resolve ? resolve(field, record) : '';
	}
	if (field.type === 'select') {
		const value = record.cells[field.id] ?? '';
		const name = field.options?.find((option) => option.id === value)?.name;
		// A stale id stays visible rather than pooling into `ungrouped`.
		return name ?? (typeof value === 'string' ? value : '');
	}
	if (field.type === 'multiSelect') {
		// The whole selection is one group (`A, B`), so no row is ever in two columns.
		return formatCell(field, record.cells[field.id] ?? '');
	}
	return formatCell(field, record.cells[field.id] ?? '');
}

/**
 * A choice column is written by id, so its title is turned back into the option it names;
 * everything else is written as the value the column carries.
 */
export function valueForColumn(field: Field, column: KanbanColumn): CellValue {
	if (column.value === null) {
		// Clearing, not a blank: `''` in a multi-select would be a value of the wrong shape.
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
		// Replacing, not adding: the card ends in exactly the column it was dropped on.
		const name = String(column.value);
		const option = field.options?.find((candidate) => candidate.name === name);
		return option ? [option.id] : [];
	}
	if (field.type === 'checkbox') {
		return column.value === true;
	}
	if (field.type === 'number' || field.type === 'autoNumber') {
		// Read back the way a typed value would be: "42%" in a percent column is 0.42,
		// while `Number()` on it is NaN and a drop would clear the cell instead of moving it.
		const parsed = parseNumberIn(field, String(column.value));
		return parsed === null ? '' : parsed;
	}
	return column.value;
}

/**
 * Only where the set is known in advance: choice and checkbox columns exist before a row
 * fills them, so a card can be dragged into an empty one.
 */
export function knownTitles(field: Field): readonly string[] {
	if (field.type === 'select') {
		return (field.options ?? []).map((option) => option.name);
	}
	if (field.type === 'multiSelect') {
		return (field.options ?? []).map((option) => option.name);
	}
	if (field.type === 'checkbox') {
		return ['true', 'false'];
	}
	return [];
}

/**
 * The ungrouped column is drawn last, so a reader meets a real value first, and only when
 * it has rows or `showEmpty` is on. `showEmpty` adds the values a column could hold but no
 * row uses, without which a card could never be dragged into an unused value.
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
		// The title is the key: two rows showing the same text share a column even when their ids differ.
		const key = text.trim();
		const existing = groups.get(key);
		if (existing) {
			existing.ids.push(record.id);
		} else {
			// A relation keeps the cell it was grouped from: its title is names on screen, and
			// names cannot be turned back into row ids. The first row to land decides.
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

	// The limit counts what is drawn, and the rest are counted as omitted. The "no value"
	// column keeps a slot of its own: its cards have nowhere else to be, and the board can
	// only report how many columns it left out, not which.
	const budget = Math.max(
		1,
		Math.floor(Number.isFinite(limit) ? limit : DEFAULT_COLUMN_LIMIT),
	);
	const drawsUngrouped = ungrouped.length > 0 || showEmpty;
	const columns: KanbanColumn[] = ordered.slice(0, drawsUngrouped ? budget - 1 : budget);

	if (drawsUngrouped) {
		// Last, and only when there is something to hold, like any unused column. It stays
		// droppable: a card dragged out of a status has to be able to end up with none.
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
 * Options keep the order the column was defined in, which is a choice the reader made;
 * numbers sort by value and everything else as text.
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
		// By the number behind the title, not `Number(title)`: "9%" and "10%" are both NaN,
		// and a comparator answering NaN leaves `sort` free to keep any order at all.
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

export interface CardColumns {
	title: Field | undefined;
	shown: readonly Field[];
}

/**
 * The title falls back to the table's primary column so an unconfigured board still shows
 * something; the grouping column is left out of the printed list.
 */
export function cardColumnsFor(
	fields: readonly Field[],
	view: KanbanView,
): CardColumns {
	const title =
		fields.find((field) => field.id === view.titleFieldId) ??
		fields.find((field) => field.primary) ??
		fields[0];
	// Table order, not the order the boxes were ticked.
	const wanted = new Set(view.cardFieldIds);
	const shown = fields.filter(
		(field) => wanted.has(field.id) && field.id !== view.groupByFieldId,
	);
	return { title, shown };
}