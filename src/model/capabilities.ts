import type {
	CellValue,
	FieldType,
	FilterOperator,
	RollupAggregate,
} from '../types';
import type { SummaryKind } from './summary';

/**
 * What each column type can do, stated once.
 *
 * Field types used to answer these questions in a dozen separate `switch`
 * statements — one in the write gate, one in the filter panel, one in the footer,
 * one in the rollup picker, one in the field editor. A rule copied that many times
 * is a rule with a mistake in it somewhere, and nobody can see the whole answer in
 * one place.
 *
 * So every "does this type do X" lives here, and the code that needs the answer
 * asks for it. The split between this file and `SPECS` in `fields.ts` is the split
 * between *whether* and *how*: this table says whether a type has options, is
 * computed, may be required, what shape its value takes, which operators, totals
 * and reductions it answers, and whether it can name a row. `SPECS` says how a
 * value of that type is formatted and parsed.
 */
export interface FieldCapability {
	/** Cells pick from this field's option list. */
	options: boolean;
	/** The value is not stored in the document; something computes it. */
	derived: boolean;
	/** The reader cannot type into it. */
	readOnly: boolean;
	/** The required flag may be set on it. */
	required: boolean;
	/** What "clear" writes: the empty value of this type's shape. */
	empty: () => CellValue;
	/** Whether a value has the shape this type stores. */
	accepts: (value: CellValue) => boolean;
	/** The operators a filter over this type offers. */
	filters: readonly FilterOperator[];
	/** What the footer may report for it. */
	summaries: readonly SummaryKind[];
	/** How a rollup may reduce it. */
	aggregates: readonly RollupAggregate[];
	/** Whether its text can stand in for a row's name. */
	namesARow: boolean;
}

const TEXT_FILTERS: readonly FilterOperator[] = [
	'is',
	'isNot',
	'contains',
	'notContains',
	'isEmpty',
	'isNotEmpty',
];
/** Numbers compare by size, so "contains" has nothing to look at. */
const NUMBER_FILTERS: readonly FilterOperator[] = [
	'is',
	'isNot',
	'greaterThan',
	'lessThan',
	'isEmpty',
	'isNotEmpty',
];
const COUNT_SUMMARIES: readonly SummaryKind[] = ['none', 'filled', 'empty', 'unique'];
const NUMBER_SUMMARIES: readonly SummaryKind[] = [
	...COUNT_SUMMARIES,
	'sum',
	'average',
	'min',
	'max',
];
/** Two dates added together are not a day, so a date is summarised as a span. */
const DATE_SUMMARIES: readonly SummaryKind[] = [
	...COUNT_SUMMARIES,
	'earliest',
	'latest',
	'range',
];
const COUNT_AGGREGATES: readonly RollupAggregate[] = ['count', 'countAll'];
const NUMBER_AGGREGATES: readonly RollupAggregate[] = [
	'sum',
	'average',
	'min',
	'max',
	'count',
	'countAll',
];
const DATE_AGGREGATES: readonly RollupAggregate[] = [
	'min',
	'max',
	'count',
	'countAll',
];

const takesText = (value: CellValue): boolean => typeof value === 'string';
/** A number cell is cleared with `''`, which is why it is allowed here too. */
const takesNumber = (value: CellValue): boolean =>
	typeof value === 'number' || value === '';
const takesList = (value: CellValue): boolean => Array.isArray(value);
const takesBoolean = (value: CellValue): boolean => typeof value === 'boolean';
/** A computed column keeps nothing, so no value can be written into it. */
const takesNothing = (): boolean => false;

const emptyText = (): CellValue => '';
const emptyList = (): CellValue => [];
const emptyBoolean = (): CellValue => false;

/**
 * The table itself, in `FIELD_TYPES` order.
 *
 * Each row is written out rather than derived from a few shared flags: "derived"
 * and "read only" differ for a note property, "required" is narrower than both,
 * and a reader of this file should be able to see one type's whole answer without
 * following a chain of conditions.
 */
export const CAPABILITIES: Record<FieldType, FieldCapability> = {
	text: {
		options: false,
		derived: false,
		readOnly: false,
		required: true,
		empty: emptyText,
		accepts: takesText,
		filters: TEXT_FILTERS,
		summaries: COUNT_SUMMARIES,
		aggregates: COUNT_AGGREGATES,
		namesARow: true,
	},
	longtext: {
		options: false,
		derived: false,
		readOnly: false,
		required: true,
		empty: emptyText,
		accepts: takesText,
		filters: TEXT_FILTERS,
		summaries: COUNT_SUMMARIES,
		aggregates: COUNT_AGGREGATES,
		namesARow: true,
	},
	number: {
		options: false,
		derived: false,
		readOnly: false,
		required: true,
		empty: emptyText,
		accepts: takesNumber,
		filters: NUMBER_FILTERS,
		summaries: NUMBER_SUMMARIES,
		aggregates: NUMBER_AGGREGATES,
		namesARow: true,
	},
	date: {
		options: false,
		derived: false,
		readOnly: false,
		required: true,
		empty: emptyText,
		accepts: takesText,
		filters: NUMBER_FILTERS,
		summaries: DATE_SUMMARIES,
		aggregates: DATE_AGGREGATES,
		namesARow: true,
	},
	datetime: {
		options: false,
		derived: false,
		readOnly: false,
		required: true,
		empty: emptyText,
		accepts: takesText,
		filters: NUMBER_FILTERS,
		summaries: DATE_SUMMARIES,
		aggregates: DATE_AGGREGATES,
		namesARow: true,
	},
	relation: {
		options: false,
		derived: false,
		readOnly: false,
		required: true,
		empty: emptyList,
		accepts: takesList,
		filters: TEXT_FILTERS,
		summaries: COUNT_SUMMARIES,
		aggregates: COUNT_AGGREGATES,
		namesARow: false,
	},
	lookup: {
		options: false,
		derived: true,
		readOnly: true,
		required: false,
		empty: emptyText,
		accepts: takesNothing,
		filters: TEXT_FILTERS,
		summaries: COUNT_SUMMARIES,
		aggregates: COUNT_AGGREGATES,
		namesARow: true,
	},
	relationBack: {
		options: false,
		derived: true,
		readOnly: true,
		required: false,
		empty: emptyText,
		accepts: takesNothing,
		filters: TEXT_FILTERS,
		summaries: COUNT_SUMMARIES,
		aggregates: COUNT_AGGREGATES,
		namesARow: false,
	},
	autoNumber: {
		options: false,
		derived: true,
		readOnly: true,
		required: false,
		empty: emptyText,
		accepts: takesNothing,
		filters: NUMBER_FILTERS,
		summaries: NUMBER_SUMMARIES,
		/* A numbering column is counted, not reduced: a rollup over it is a count. */
		aggregates: COUNT_AGGREGATES,
		namesARow: true,
	},
	rollup: {
		options: false,
		derived: true,
		readOnly: true,
		required: false,
		empty: emptyText,
		accepts: takesNothing,
		filters: TEXT_FILTERS,
		summaries: COUNT_SUMMARIES,
		aggregates: COUNT_AGGREGATES,
		namesARow: true,
	},
	formula: {
		options: false,
		derived: true,
		readOnly: true,
		required: false,
		empty: emptyText,
		accepts: takesNothing,
		filters: TEXT_FILTERS,
		summaries: COUNT_SUMMARIES,
		aggregates: COUNT_AGGREGATES,
		namesARow: true,
	},
	select: {
		options: true,
		derived: false,
		readOnly: false,
		required: true,
		empty: emptyText,
		accepts: takesText,
		filters: TEXT_FILTERS,
		summaries: COUNT_SUMMARIES,
		aggregates: COUNT_AGGREGATES,
		namesARow: true,
	},
	multiSelect: {
		options: true,
		derived: false,
		readOnly: false,
		required: true,
		empty: emptyList,
		accepts: takesList,
		filters: TEXT_FILTERS,
		summaries: COUNT_SUMMARIES,
		aggregates: COUNT_AGGREGATES,
		namesARow: true,
	},
	checkbox: {
		options: false,
		derived: false,
		readOnly: false,
		required: true,
		empty: emptyBoolean,
		accepts: takesBoolean,
		filters: ['checked', 'unchecked'],
		summaries: COUNT_SUMMARIES,
		aggregates: COUNT_AGGREGATES,
		namesARow: false,
	},
	note: {
		options: false,
		derived: false,
		readOnly: false,
		required: true,
		empty: emptyText,
		accepts: takesText,
		filters: TEXT_FILTERS,
		summaries: COUNT_SUMMARIES,
		aggregates: COUNT_AGGREGATES,
		namesARow: true,
	},
	noteProp: {
		options: false,
		/* Derived, yet editable: the value lives in a note, and an edit goes back
		 * there rather than being refused. */
		derived: true,
		readOnly: false,
		required: false,
		empty: emptyText,
		/* Editable, but never through the stored-value path: an edit is routed to
		 * the note's frontmatter, so no value is written into this document. */
		accepts: takesNothing,
		filters: TEXT_FILTERS,
		summaries: COUNT_SUMMARIES,
		aggregates: COUNT_AGGREGATES,
		namesARow: true,
	},
};

/** The row for one type. */
export function capabilityOf(type: FieldType): FieldCapability {
	return CAPABILITIES[type];
}

/** Whether a value has the shape this type stores. */
export function acceptsValue(type: FieldType, value: CellValue): boolean {
	return CAPABILITIES[type].accepts(value);
}
