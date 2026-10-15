/**
 * Core types for the `.layer` file format.
 *
 * Two invariants drive the whole schema and must not be broken by later
 * milestones:
 *
 * 1. `Record.cells` is keyed by **field id**, never by field name, so renaming
 *    a column cannot orphan its data.
 * 2. `select` / `multiSelect` cell values store **option ids**, never option
 *    names, so renaming or recolouring an option cannot orphan its data.
 */

/** Current file format version. Bump when the on-disk shape changes. */
export const LAYER_FORMAT_VERSION = 1;

/**
 * The field types a board can hold.
 *
 * Deliberately short. Types are added one at a time, each with its own spec in
 * `model/fields.ts` and its own editor, so that a half-finished type cannot sit
 * in the codebase looking supported. Everything else (numbers, dates,
 * checkboxes, links, note references, multi-select) is still to come.
 */
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
	/** Marks the column used as a record's display title. Exactly one per file. */
	primary?: boolean;
	/**
	 * Frontmatter key this field writes back to when the record is linked to a
	 * note. Defaults to `name` when absent.
	 */
	frontmatterKey?: string;
	/** `select` only. */
	options?: SelectOption[];
}

/**
 * Value stored for one field on one record.
 *
 * A string, because both current types store one: `text` holds the text as
 * written, and `select` holds an option id. Narrowing this is what lets the
 * model stop carrying branches for arrays, numbers and booleans that no type can
 * produce. A type needing another shape widens this again when it is added.
 */
export type CellValue = string;

export interface Record_ {
	id: string;
	/**
	 * Creation time as an ISO 8601 string, e.g. `2024-10-28T02:13:20.000Z`.
	 *
	 * Stored as text rather than an epoch number so that both a person and an AI
	 * reading the raw file can tell what the value means without consulting the
	 * schema. A number is not accepted: there is no older format to convert from.
	 */
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
	/** Primitive expectation; compared against the field's canonical value. */
	value?: string | number | boolean | null;
}

export interface Filter {
	conjunction: 'and' | 'or';
	conditions: FilterCondition[];
}

/** Shared by every view type; view-specific keys live on the subclasses. */
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
	/**
	 * Column widths in pixels, keyed by field id.
	 *
	 * A view property rather than a field property, for the same reason
	 * `hiddenFieldIds` is: how wide a column should be is a question about this
	 * way of looking at the data, and another view may answer it differently.
	 *
	 * A missing key means "use the default width", so a board only stores the
	 * columns someone actually resized instead of freezing every width.
	 */
	columnWidths: Record<string, number>;
	/** Row heights in pixels, keyed by record id. Missing means the default. */
	rowHeights: Record<string, number>;
}

/** Board view: columns are the options of `groupByFieldId`. */
export interface KanbanView extends BaseView {
	type: 'kanban';
	/** Must reference a `select` field. */
	groupByFieldId: string;
	/** Fields shown on each card. */
	cardFieldIds: string[];
}

export type View = GridView | KanbanView;

/**
 * The whole `.layer` file: one database, several views over the same data.
 *
 * Every record here is content the user owns. The file stays plain JSON so that
 * it can be diffed, synced, recovered and edited by an AI agent; nothing about
 * it depends on the plugin being installed.
 */
export interface LayerDoc {
	version: number;
	name: string;
	fields: Field[];
	records: LayerRecord[];
	views: View[];
}