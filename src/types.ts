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

/** A percent field stores a proportion — `0.15` is fifteen percent, bounds are 0 and 1 — and the
 * sign is added when shown; a field that omits the format is plain. */
export type NumberFormat = 'plain' | 'percent';

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
	/** Cells must not be left empty. Missing and `false` mean the same, so it is only written when true. */
	required?: boolean;
	frontmatterKey?: string;
	/** `noteProp` only: the `note` column whose file is read; the value lives in that file's
	 * frontmatter under `frontmatterKey`. */
	noteFieldId?: string;
	options?: SelectOption[];
	numberFormat?: NumberFormat;
	/** Decimal places; missing means as typed, not zero. */
	decimals?: number;
	min?: number;
	max?: number;
	/** `relation` only: the `.layer` table to pick rows from; missing means this table. */
	linkPath?: string;
	linkFieldId?: string;
	/** `relationBack` only: the table pointing back here; missing means this table. */
	backPath?: string;
	backFieldId?: string;
	backTitleFieldId?: string;
	/** `formula` only: the expression; other columns are named `{their name}`, and cells store nothing. */
	formula?: string;
	/** `formula` only: how the result is presented. Changes the dressing, never the computed value. */
	formulaType?: FormulaResultType;
	/** `rollup` only: the relation column to gather rows through, which may point back at this table. */
	rollupSourceFieldId?: string;
	rollupFieldId?: string;
	rollupAggregate?: RollupAggregate;
	lookupSourceFieldId?: string;
	lookupFieldId?: string;
	numberLength?: number;
	numberGroupFieldId?: string;
}

export type RollupAggregate =
	| 'sum'
	| 'average'
	| 'min'
	| 'max'
	| 'count'
	| 'countAll';

export type FormulaResultType = 'number' | 'text' | 'boolean';

/** One cell, in its field type's shape; empty is `''`. Dates are `YYYY-MM-DD`, date-times
 * `YYYY-MM-DDTHH:mm` in local wall-clock time and never converted. The union is checked where
 * a value enters the document, not by the type. */
export type CellValue = string | string[] | boolean | number;

export interface Record_ {
	id: string;
	created: string;
	/** Keyed by field id; write through `setCellValue` / `setCellFromText`, which check the shape
	 * against the column's type. */
	cells: Record<string, CellValue>;
}

/** The board's row. Aliased because Obsidian's own generic `Record` would shadow it. */
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

/** A filter condition with a colour attached. It shares the condition's meaning, so a colour rule
 * cannot decide differently from the filter. */
export interface ColorRule extends FilterCondition {
	color: string;
}

export interface BaseView {
	id: string;
	name: string;
	filter: Filter;
	sorts: Sort[];
	hiddenFieldIds: string[];
}

export interface GridView extends BaseView {
	type: 'grid';
	columnWidths: Record<string, number>;
	/** The height rows start at, before any were dragged; missing means the default. */
	rowHeight?: number;
	rowHeights: Record<string, number>;
	/** Whether a cell's value may run onto more lines. A wrapped value adds to the row's height;
	 * long text scrolls inside its cell instead. */
	wrap?: boolean;
	/** Whole-row tints, tried in order; only the first rule a row matches is drawn. */
	colorRules?: ColorRule[];
	/** What each column's footer reports; a column with no entry is not summarised. */
	summaries?: Record<string, SummaryKind>;
}

/** Board view: one column per value of `groupByFieldId`. */
export interface KanbanView extends BaseView {
	type: 'kanban';
	groupByFieldId: string;
	/** The column a card is titled by; missing means the table's primary column. */
	titleFieldId?: string;
	cardFieldIds: string[];
	/** How many columns to draw before the rest are counted and left out; missing means the default. */
	columnLimit?: number;
	/** Also draw columns no row uses yet, so a card can be dragged into them. */
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