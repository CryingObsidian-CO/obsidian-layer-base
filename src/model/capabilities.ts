import type {
	CellValue,
	FieldType,
	FilterOperator,
	RollupAggregate,
} from '../types';
import type { SummaryKind } from './summary';

/** Whether a field type does something; `SPECS` in `fields.ts` says how its values are formatted and parsed. */
export interface FieldCapability {
	options: boolean;
	derived: boolean;
	/** Derived cells store nothing and `relation` stores row ids, so neither reads from the document. */
	readsFromView: boolean;
	readOnly: boolean;
	required: boolean;
	empty: () => CellValue;
	accepts: (value: CellValue) => boolean;
	filters: readonly FilterOperator[];
	summaries: readonly SummaryKind[];
	aggregates: readonly RollupAggregate[];
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
const takesNothing = (): boolean => false;

const emptyText = (): CellValue => '';
const emptyList = (): CellValue => [];
const emptyBoolean = (): CellValue => false;

/** Written out per type rather than derived from shared flags: `derived`, `readOnly` and `required` differ for `noteProp`. */
export const CAPABILITIES: Record<FieldType, FieldCapability> = {
	text: {
		options: false,
		derived: false,
		readsFromView: false,
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
		readsFromView: false,
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
		readsFromView: false,
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
		readsFromView: false,
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
		readsFromView: false,
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
		/* Stored, but as row ids: the document holds links, not names. */
		derived: false,
		readsFromView: true,
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
		readsFromView: true,
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
		readsFromView: true,
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
		readsFromView: true,
		readOnly: true,
		required: false,
		empty: emptyText,
		accepts: takesNothing,
		filters: NUMBER_FILTERS,
		summaries: NUMBER_SUMMARIES,
		/* Counted, not reduced: a rollup over a numbering column is a count. */
		aggregates: COUNT_AGGREGATES,
		namesARow: true,
	},
	rollup: {
		options: false,
		derived: true,
		readsFromView: true,
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
		readsFromView: true,
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
		readsFromView: false,
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
		readsFromView: false,
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
		readsFromView: false,
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
		readsFromView: false,
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
		/* Derived yet editable: the value lives in a note, and an edit goes back there. */
		derived: true,
		readsFromView: true,
		readOnly: false,
		required: false,
		empty: emptyText,
		/* Editable, but only through the note: no value is written into this document. */
		accepts: takesNothing,
		filters: TEXT_FILTERS,
		summaries: COUNT_SUMMARIES,
		aggregates: COUNT_AGGREGATES,
		namesARow: true,
	},
};

export function capabilityOf(type: FieldType): FieldCapability {
	return CAPABILITIES[type];
}

export function acceptsValue(type: FieldType, value: CellValue): boolean {
	return CAPABILITIES[type].accepts(value);
}

/** Ask this before falling back to the stored value: it is wrong for formulas and relations alike. */
export function readsFromView(type: FieldType): boolean {
	return CAPABILITIES[type].readsFromView;
}
