export const LAYER_FORMAT_VERSION = 1;

import type { SummaryKind } from './model/summary';

export type FieldType =
	| 'text'
	| 'longtext'
	| 'number'
	| 'date'
	| 'datetime'
	| 'relation'
	| 'lookup'
	| 'relationBack'
	| 'autoNumber'
	| 'rollup'
	| 'formula'
	| 'select'
	| 'multiSelect'
	| 'checkbox'
	| 'note'
	| 'noteProp';

/** What a `note` cell shows: the file's own name, or the path it lives at. */
export type NoteLabelStyle = 'name' | 'path';

/**
 * How a `number` field shows its value. The stored number is always what was
 * typed, so `%` is a suffix on the display and never a conversion: 50 in a
 * percent field is fifty percent, and its bounds are 0 and 100, not 0 and 1.
 */
export type NumberFormat = 'plain' | 'percent';

/** A single choice of a `select` or `multiSelect` field. */
export interface SelectOption {
	id: string;
	name: string;
	color: string;
}

export interface Field {
	id: string;
	name: string;
	type: FieldType;
	primary?: boolean;
	/**
	 * Cells in this field must not be left empty. A missing flag and `false` mean
	 * the same thing, so the flag is only written when it is true.
	 */
	required?: boolean;
	frontmatterKey?: string;
	/**
	 * `noteProp` fields only: the `note` column whose file is read. The value of the
	 * cell lives in that file's frontmatter, under `frontmatterKey`.
	 */
	noteFieldId?: string;
	options?: SelectOption[];
	/** `number` fields only: the display format. Missing means plain. */
	numberFormat?: NumberFormat;
	/** `number` fields only: decimal places. Missing means as typed. */
	decimals?: number;
	/** `number` fields only: the smallest value the cell may hold. */
	min?: number;
	/** `number` fields only: the largest value the cell may hold. */
	max?: number;
	/**
	 * `relation` fields only: the `.layer` file whose rows a cell picks from.
	 * Missing means this table, so a self-reference needs no path at all.
	 */
	linkPath?: string;
	/** `relation` fields only: the column of that table whose values are shown. */
	linkFieldId?: string;
	/**
	 * `relationBack` fields only: the table whose rows point back at this one.
	 * Missing means this table, the same way `linkPath` does.
	 */
	backPath?: string;
	/** `relationBack` fields only: the `relation` column in that table. */
	backFieldId?: string;
	/**
	 * `relationBack` fields only: the column a pointing row is named by. Missing
	 * means the row's number, which is what an unconfigured column shows.
	 */
	backTitleFieldId?: string;
	/**
	 * `formula` fields only: the expression this column is computed from. Other
	 * columns are named with `{their name}`; nothing about it is stored in cells.
	 */
	formula?: string;
	/**
	 * `formula` fields only: how the result is presented, for a column whose rows
	 * compute different kinds. Missing means the result's own kind decides. It
	 * changes the dressing only — never the computed value.
	 */
	formulaType?: FormulaResultType;
	/**
	 * `rollup` fields only: the relation column in this table whose rows are
	 * gathered. It may be a `relation` or a `relationBack`, which is what lets a
	 * parent table total its children.
	 */
	rollupSourceFieldId?: string;
	/** `rollup` fields only: the column in the other table that is read. */
	rollupFieldId?: string;
	/** `rollup` fields only: how the gathered values are reduced to one. */
	rollupAggregate?: RollupAggregate;
	/**
	 * `lookup` fields only: the relation column in this table whose rows are read.
	 * Same idea as `rollupSourceFieldId`, without the reduction.
	 */
	lookupSourceFieldId?: string;
	/**
	 * `lookup` fields only: the column in the other table whose values are shown,
	 * one per row found through the relation. Nothing is stored in this document.
	 */
	lookupFieldId?: string;
	/** `autoNumber` fields only: how many digits the number is padded to; missing means one. */
	numberLength?: number;
	/** `autoNumber` fields only: the column whose values are numbered separately. */
	numberGroupFieldId?: string;
}

/** How a `rollup` field reduces the values it gathered. */
export type RollupAggregate =
	| 'sum'
	| 'average'
	| 'min'
	| 'max'
	| 'count'
	| 'countAll';

/** How a `formula` field presents what it computed. */
export type FormulaResultType = 'number' | 'text' | 'boolean';

/**
 * What one cell holds, in the shape its field type uses: text, long text, date
 * and date-time keep a string, `number` a real number, `multiSelect` an array of
 * option ids, and `checkbox` a real boolean. An empty cell of any type is `''`.
 *
 * A date is `YYYY-MM-DD`; a date-time is `YYYY-MM-DDTHH:mm` in **local wall-clock
 * time**, carrying no zone and never converted — what was entered is what is
 * shown, in any timezone.
 */
export type CellValue = string | string[] | boolean | number;

export interface Record_ {
	id: string;
	created: string;
	cells: Record<string, CellValue>;
}

/*
 * A row of the board. The alias exists because Obsidian's own `Record` type is
 * generic and would otherwise shadow this one wherever both are imported.
 */
export type LayerRecord = Record_;

export type SortOrder = 'asc' | 'desc';

export interface Sort {
	fieldId: string;
	order: SortOrder;
}

export type FilterOperator =
	| 'is'
	| 'isNot'
	| 'contains'
	| 'notContains'
	| 'isEmpty'
	| 'isNotEmpty'
	| 'greaterThan'
	| 'lessThan'
	| 'checked'
	| 'unchecked';

export interface FilterCondition {
	fieldId: string;
	operator: FilterOperator;
	value?: string | number | boolean | null;
}

export interface Filter {
	conjunction: 'and' | 'or';
	conditions: FilterCondition[];
}

/**
 * A rule that tints a whole row when its condition matches.
 *
 * It is a filter condition with a colour attached, on purpose: "when this column
 * contains this" has exactly one meaning in this plugin, and a colour rule that
 * decided it differently from the filter would be a second opinion nobody asked
 * for.
 */
export interface ColorRule extends FilterCondition {
	/** A name from the palette in `model/select-options.ts`. */
	color: string;
}

export interface BaseView {
	id: string;
	name: string;
	filter: Filter;
	sorts: Sort[];
	hiddenFieldIds: string[];
}

/** Table view: rows are records, columns are fields. */
export interface GridView extends BaseView {
	type: 'grid';
	columnWidths: Record<string, number>;
	/**
	 * The height every row starts at, before any of them were dragged. Missing
	 * means the default, so a table written before this existed reads as it did.
	 */
	rowHeight?: number;
	/** Rows dragged to a height of their own, which outrank `rowHeight`. */
	rowHeights: Record<string, number>;
	/**
	 * Whether each cell's value may run onto more lines.
	 *
	 * A wrapped run of values adds to the row's height, so this is also what makes
	 * a row taller than the height chosen for it. Long text is left out either way:
	 * it scrolls inside its cell rather than growing the row.
	 */
	wrap?: boolean;
	/**
	 * Whole-row tints, tried in the order they are listed. Only the first rule a
	 * row matches is drawn, so the list order is the priority.
	 */
	colorRules?: ColorRule[];
	/**
	 * What each column's footer reports, by column id. A column with no entry is not
	 * summarised, so a table only shows figures someone asked for.
	 */
	summaries?: Record<string, SummaryKind>;
}

/** Board view: columns are the options of `groupByFieldId`. */
export interface KanbanView extends BaseView {
	type: 'kanban';
	groupByFieldId: string;
	/**
	 * The column a card is titled by. Missing means the table's primary column,
	 * which is what a board that was never configured shows.
	 */
	titleFieldId?: string;
	/** The columns shown under the title on each card, in this order. */
	cardFieldIds: string[];
	/**
	 * How many columns the board draws before the rest are counted and left out.
	 * Missing means the default, which is what a board that was never configured
	 * uses. A board of dates can produce a column per day, so the limit is a
	 * property of the board rather than of the table.
	 */
	columnLimit?: number;
	/**
	 * Whether a board draws the columns its grouping column could hold but no row
	 * uses yet. Without it a board of choices only offers the values already taken,
	 * so a card could never be dragged into a value nobody has chosen.
	 */
	showEmptyColumns?: boolean;
}

export type View = GridView | KanbanView;

export interface LayerDoc {
	version: number;
	name: string;
	fields: Field[];
	records: LayerRecord[];
	views: View[];
}