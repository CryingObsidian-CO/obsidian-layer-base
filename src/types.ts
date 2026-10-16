export const LAYER_FORMAT_VERSION = 1;

export type FieldType = 'text' | 'select';

/** A single choice of a `select` field. */
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
}

export type CellValue = string;

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