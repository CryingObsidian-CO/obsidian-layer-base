export const LAYER_FORMAT_VERSION = 1;

export type FieldType =
	| 'text'
	| 'longtext'
	| 'number'
	| 'date'
	| 'datetime'
	| 'relation'
	| 'relationBack'
	| 'formula'
	| 'select'
	| 'multiSelect'
	| 'checkbox';

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
}

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

/** Rename this to `LayerRecord` once the Obsidian `Record` type is no longer in scope. */
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
	rowHeights: Record<string, number>;
}

/** Board view: columns are the options of `groupByFieldId`. */
export interface KanbanView extends BaseView {
	type: 'kanban';
	groupByFieldId: string;
	cardFieldIds: string[];
}

export type View = GridView | KanbanView;

export interface LayerDoc {
	version: number;
	name: string;
	fields: Field[];
	records: LayerRecord[];
	views: View[];
}