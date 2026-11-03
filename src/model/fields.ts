import type {CellValue, Field, FieldType, SelectOption} from '../types';
import {displayDateTime, normaliseDate, normaliseDateTime} from './date';
import {numberText} from './auto-number';
import {capabilityOf} from './capabilities';
import {constrainNumber, formatNumber, parseNumber} from './number';

export interface FieldTypeSpec {
	readonly type: FieldType;
	readonly icon: string;

	toText(field: Field, value: CellValue): string;

	fromText(field: Field, text: string): TextParseResult;

	/** Whether this type's cells hold nothing. Every type answers for itself. */
	isEmpty(value: CellValue): boolean;
}

export type TextParseResult = {ok: true; value: CellValue} | {ok: false};

const REFUSED: TextParseResult = {ok: false};

function accept(value: CellValue): TextParseResult {
	return {ok: true, value};
}

function optionByName(field: Field, name: string): SelectOption | undefined {
	const wanted = name.trim().toLowerCase();
	return field.options?.find((o) => o.name.trim().toLowerCase() === wanted);
}

/** The stored value read as a list of option ids, whatever shape it arrived in. */
export function optionIds(value: CellValue): string[] {
	return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [];
}

/** The row ids a relation cell holds. */
export function relationIds(value: CellValue): string[] {
	return optionIds(value);
}

/** The names a `multiSelect` value shows, in the field's own option order. */
function multiNames(field: Field, value: CellValue): string {
	return optionsOf(field, value)
		.map((option) => option.name)
		.join(', ');
}

/** The options a value selects, in the field's order. Ids with no option are stale. */
export function optionsOf(field: Field, value: CellValue): SelectOption[] {
	const ids = optionIds(value);
	return (field.options ?? []).filter((option) => ids.includes(option.id));
}

/** Option names, comma separated — and parseable back into ids by `parseMulti`. */
function parseMulti(field: Field, text: string): TextParseResult {
	const trimmed = text.trim();
	if (trimmed === '') {
		return accept([]);
	}
	const names = trimmed
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part !== '');
	const ids: string[] = [];
	for (const name of names) {
		const option = optionByName(field, name);
		if (!option) {
			return REFUSED;
		}
		if (!ids.includes(option.id)) {
			ids.push(option.id);
		}
	}
	return accept(ids);
}

const SPECS: Record<FieldType, FieldTypeSpec> = {
	text: {
		type: 'text',
		icon: 'type',
		toText: (_field, value) => (typeof value === 'string' ? value : ''),
		fromText: (_field, text) => accept(text),
		isEmpty: (value) => value === '',
	},

	longtext: {
		type: 'longtext',
		icon: 'align-left',
		toText: (_field, value) => (typeof value === 'string' ? value : ''),
		fromText: (_field, text) => accept(text),
		isEmpty: (value) => value === '',
	},

	/*
	 * A link to a note in the vault, held as its path. It reads and writes like text
	 * because the value is a path; what earns it a type of its own is that the view
	 * offers a picker and can open the note it names.
	 */
	note: {
		type: 'note',
		icon: 'file-text',
		toText: (_field, value) => (typeof value === 'string' ? value : ''),
		fromText: (_field, text) => accept(text.trim()),
		isEmpty: (value) => value === '',
	},

	/*
	 * A value that lives in another file's frontmatter. Nothing is stored in the table:
	 * the view reads it from the note the row's `note` column names, and writes an edit
	 * back to that file. So this type answers text with nothing and refuses text, and
	 * every cell of it is empty as far as the document is concerned.
	 */
	noteProp: {
		type: 'noteProp',
		icon: 'file-cog',
		toText: () => '',
		fromText: () => REFUSED,
		isEmpty: () => true,
	},

	number: {
		type: 'number',
		icon: 'hash',
		// The display text, so a copied cell reads the way it looks.
		toText: (field, value) =>
			typeof value === 'number' ? formatNumber(value, field) : '',
		fromText: (field, text) => {
			const parsed = parseNumber(text);
			return parsed === null ? REFUSED : accept(constrainNumber(parsed, field));
		},
		// A cell with no number holds `''`, like text. Zero is a value.
		isEmpty: (value) => value === '',
	},

	date: {
		type: 'date',
		icon: 'calendar',
		toText: (_field, value) => (typeof value === 'string' ? value : ''),
		fromText: (_field, text) => {
			if (text.trim() === '') {
				return accept('');
			}
			const date = normaliseDate(text);
			return date === null ? REFUSED : accept(date);
		},
		isEmpty: (value) => value === '',
	},

	datetime: {
		type: 'datetime',
		icon: 'calendar-clock',
		// Shown with a space, which is how a date and a time read together.
		toText: (_field, value) =>
			typeof value === 'string' && value !== ''
				? displayDateTime(value)
				: '',
		fromText: (_field, text) => {
			if (text.trim() === '') {
				return accept('');
			}
			const moment = normaliseDateTime(text);
			return moment === null ? REFUSED : accept(moment);
		},
		isEmpty: (value) => value === '',
	},

	relation: {
		type: 'relation',
		icon: 'link',
		// Ids are a fallback only: what a relation reads as needs the other table,
		// which the caller has and this module does not.
		toText: (_field, value) => relationIds(value).join(', '),
		// A relation cannot be typed in as text, so a paste into it is refused
		// rather than turned into references to nothing.
		fromText: () => REFUSED,
		isEmpty: (value) => relationIds(value).length === 0,
	},

	lookup: {
		type: 'lookup',
		icon: 'search',
		// Nothing to read: the values are gathered from other rows, which this
		// module cannot see.
		toText: () => '',
		fromText: () => REFUSED,
		// Always "empty": it stores nothing, so there is nothing here to be full.
		isEmpty: () => true,
	},

	relationBack: {
		type: 'relationBack',
		icon: 'git-fork',
		// Nothing to read: the values are derived from the other table, and this
		// module cannot see it.
		toText: () => '',
		fromText: () => REFUSED,
		// Always "empty": it stores nothing, so there is nothing here to be full.
		isEmpty: () => true,
	},

	autoNumber: {
		type: 'autoNumber',
		icon: 'hash',
		toText: numberText,
		fromText: () => REFUSED,
		isEmpty: (value) => value === '' || value === undefined,
	},

	rollup: {
		type: 'rollup',
		icon: 'calculator',
		// Nothing to read: the value is gathered from other rows, which this module
		// cannot see.
		toText: () => '',
		fromText: () => REFUSED,
		isEmpty: () => true,
	},

	formula: {
		type: 'formula',
		icon: 'sigma',
		// Nothing to read: the value is computed from the row, which this module
		// cannot see.
		toText: () => '',
		fromText: () => REFUSED,
		// Always "empty": it stores nothing, so there is nothing here to be full.
		isEmpty: () => true,
	},

	select: {
		type: 'select',
		icon: 'circle',
		// A stale id stays visible rather than vanishing from the grid: an id with no
		// option is still what the cell holds, and hiding it would look like data
		// loss rather than a deleted choice.
		toText: (field, value) => {
			const name = field.options?.find((o) => o.id === value)?.name;
			return name ?? (typeof value === 'string' ? value : '');
		},
		fromText: (field, text) => {
			if (text.trim() === '') {
				return accept('');
			}
			const option = optionByName(field, text);
			return option ? accept(option.id) : REFUSED;
		},
		isEmpty: (value) => value === '',
	},

	multiSelect: {
		type: 'multiSelect',
		icon: 'list-checks',
		toText: multiNames,
		fromText: parseMulti,
		isEmpty: (value) => optionIds(value).length === 0,
	},

	checkbox: {
		type: 'checkbox',
		icon: 'check-square',
		toText: (_field, value) => (value === true ? 'true' : ''),
		fromText: (_field, text) => {
			const wanted = text.trim().toLowerCase();
			if (wanted === '') {
				return accept(false);
			}
			if (wanted === 'true' || wanted === 'yes' || wanted === '1') {
				return accept(true);
			}
			if (wanted === 'false' || wanted === 'no' || wanted === '0') {
				return accept(false);
			}
			return REFUSED;
		},
		// An unticked box is empty, which is what lets `required` mean "must be ticked".
		isEmpty: (value) => value !== true,
	},
};

export const FIELD_TYPES: readonly FieldType[] = [
	'text',
	'longtext',
	'number',
	'date',
	'datetime',
	'relation',
	'lookup',
	'relationBack',
	'autoNumber',
	'rollup',
	'formula',
	'select',
	'multiSelect',
	'checkbox',
	'note',
	'noteProp',
];

export function specFor(type: FieldType): FieldTypeSpec {
	return SPECS[type];
}

/** Whether a type's cells choose from the field's option list. */
export function usesOptions(type: FieldType): boolean {
	return capabilityOf(type).options;
}

/**
 * The value that means "nothing" for a field's type: clearing is `[]` or `false`,
 * not `''`, wherever the shape matters.
 */
export function emptyValueFor(field: Field): CellValue {
	return capabilityOf(field.type).empty();
}

export function isEmptyCell(value: CellValue): boolean {
	// A value with no field to interpret it is empty only when it holds nothing.
	if (Array.isArray(value)) {
		return value.length === 0;
	}
	return value === '' || value === false;
}

/**
 * A required field whose cell holds nothing — the state the grid warns about.
 *
 * Lives here rather than in the grid so it can be unit tested: the grid imports
 * `obsidian`, which ships types only.
 */
export function isMissingRequired(field: Field, value: CellValue): boolean {
	// A derived cell holds nothing by definition, so it can never be the thing a
	// required field is waiting for.
	if (isDerived(field.type)) {
		return false;
	}
	return field.required === true && isEmptyCell(value);
}

/**
 * Whether a type's values are computed rather than stored.
 *
 * An `autoNumber` counts its position in the table, so it belongs here: nothing is
 * written down, and the number moves when the rows around it move. The answer is
 * in the capability table, which is the one place a per-type yes or no is decided.
 */
export function isDerived(type: FieldType): boolean {
	return capabilityOf(type).derived;
}

/** Whether the table fills this cell in, so nothing here can be typed into. */
export function isReadOnly(type: FieldType): boolean {
	return capabilityOf(type).readOnly;
}

/**
 * Whether a column may be marked required.
 *
 * The flag means "this cell must not be left empty", so it only makes sense where
 * the reader is the one filling the cell in. The table answers a derived column
 * itself, and an auto number counts its own rows; neither is the reader's to leave
 * empty. A `noteProp` is editable but reads another file's frontmatter, so its
 * emptiness is not this table's to enforce — the warning would never fire.
 */
export function canBeRequired(type: FieldType): boolean {
	return capabilityOf(type).required;
}

export function cellToText(field: Field, value: CellValue): string {
	return SPECS[field.type].toText(field, value);
}

export function cellFromText(field: Field, text: string): TextParseResult {
	return SPECS[field.type].fromText(field, text);
}

/**
 * What a cell reads as.
 *
 * A lookup into `SPECS` rather than a chain of type tests: the chain had to be
 * edited by hand whenever a type was added, and `tsc` cannot see a missing branch
 * in an `if` — an unhandled type silently rendered as an empty cell. Through the
 * table, a type with no `toText` fails to compile.
 *
 * An empty value reads as nothing whatever its type, which is what lets an
 * unticked box show a box in the grid and still copy as empty text.
 */
export function formatCell(field: Field, value: CellValue): string {
	if (isEmptyCell(value)) {
		return '';
	}
	return SPECS[field.type].toText(field, value);
}

export function recordTitle(
	doc: {fields: Field[]},
	record: {cells: Record<string, CellValue>},
): string {
	const primary = doc.fields.find((f) => f.primary) ?? doc.fields[0];
	if (!primary) {
		return '';
	}
	return formatCell(primary, record.cells[primary.id] ?? '');
}

/**
 * A cell value as one string, for the places that carry text only — a cell's
 * `dataset`, notably. JSON, not a join: a set and the string of its ids must not
 * read back as the same value.
 */
export function serializeCellValue(value: CellValue): string {
	if (typeof value === 'string') {
		return value;
	}
	return JSON.stringify(value);
}

/** The inverse of `serializeCellValue`, read back for a specific field. */
export function deserializeCellValue(raw: string, field: Field): CellValue {
	if (field.type === 'multiSelect' || field.type === 'relation') {
		try {
			const parsed: unknown = JSON.parse(raw);
			return optionIds(parsed as CellValue);
		} catch {
			// A hand-written or legacy string: fall back to a comma-separated list.
			return raw
				.split(',')
				.map((part) => part.trim())
				.filter((part) => part !== '');
		}
	}
	if (field.type === 'checkbox') {
		return raw === 'true';
	}
	if (field.type === 'number') {
		const parsed = parseNumber(raw);
		return parsed === null ? '' : parsed;
	}
	return raw;
}

/**
 * What copying a cell should put on the clipboard.
 *
 * A stored column contributes the text its own type gives. A derived one stores
 * nothing, so its text has to be supplied by whoever could compute it — the view
 * that can see the other table, or the formula's row. Passing no text for a derived
 * column copies an empty cell, because there is nothing stored to copy.
 */
export function copyTextFor(
	field: Field,
	value: CellValue,
	computed?: string,
): string {
	if (isDerived(field.type)) {
		return computed ?? '';
	}
	return cellToText(field, value);
}