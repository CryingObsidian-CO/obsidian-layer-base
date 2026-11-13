import type {CellValue, Field, FieldType, SelectOption} from '../types';
import {displayDateTime, normaliseDate, normaliseDateTime} from './date';
import {capabilityOf, readsFromView} from './capabilities';
import {constrainNumber, formatNumber, parseNumber, parseNumberIn} from './number';

export interface FieldTypeSpec {
	readonly type: FieldType;
	readonly icon: string;

	toText(field: Field, value: CellValue): string;

	fromText(field: Field, text: string): TextParseResult;

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

export function optionIds(value: CellValue): string[] {
	return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [];
}

export function relationIds(value: CellValue): string[] {
	return optionIds(value);
}

function multiNames(field: Field, value: CellValue): string {
	return optionsOf(field, value)
		.map((option) => option.name)
		.join(', ');
}

export function optionsOf(field: Field, value: CellValue): SelectOption[] {
	const ids = optionIds(value);
	return (field.options ?? []).filter((option) => ids.includes(option.id));
}

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

	// Held as a vault path and read like text; the type exists so the view can offer a picker and open the note.
	note: {
		type: 'note',
		icon: 'file-text',
		toText: (_field, value) => (typeof value === 'string' ? value : ''),
		fromText: (_field, text) => accept(text.trim()),
		isEmpty: (value) => value === '',
	},

	// Nothing is stored in the table: the value lives in another file's frontmatter,
	// read and written through the row's `note` column.
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
			const parsed = parseNumberIn(field, text);
			return parsed === null ? REFUSED : accept(constrainNumber(parsed, field));
		},
		// Zero is a value; a cell with no number holds `''`.
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
		// Ids only: the names need the other table, which this module cannot see.
		toText: (_field, value) => relationIds(value).join(', '),
		// Refused rather than parsed: an id typed as text would point at nothing.
		fromText: () => REFUSED,
		isEmpty: (value) => relationIds(value).length === 0,
	},

	lookup: {
		type: 'lookup',
		icon: 'search',
		toText: () => '',
		fromText: () => REFUSED,
		isEmpty: () => true,
	},

	relationBack: {
		type: 'relationBack',
		icon: 'git-fork',
		toText: () => '',
		fromText: () => REFUSED,
		isEmpty: () => true,
	},

	autoNumber: {
		type: 'autoNumber',
		icon: 'hash',
		toText: () => '',
		fromText: () => REFUSED,
		isEmpty: () => true,
	},

	rollup: {
		type: 'rollup',
		icon: 'calculator',
		toText: () => '',
		fromText: () => REFUSED,
		isEmpty: () => true,
	},

	formula: {
		type: 'formula',
		icon: 'sigma',
		toText: () => '',
		fromText: () => REFUSED,
		isEmpty: () => true,
	},

	select: {
		type: 'select',
		icon: 'circle',
		// A stale id shows as itself rather than vanishing, which would look like data loss.
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

export function usesOptions(type: FieldType): boolean {
	return capabilityOf(type).options;
}

/** The value clearing a cell writes: `[]` or `false`, not `''`, wherever the shape matters. */
export function emptyValueFor(field: Field): CellValue {
	return capabilityOf(field.type).empty();
}

export function isEmptyCell(value: CellValue): boolean {
	if (Array.isArray(value)) {
		return value.length === 0;
	}
	return value === '' || value === false;
}

export function isMissingRequired(field: Field, value: CellValue): boolean {
	// A derived cell holds nothing by definition, so it can never satisfy `required`.
	if (isDerived(field.type)) {
		return false;
	}
	return field.required === true && isEmptyCell(value);
}

/** Computed rather than stored; an `autoNumber` counts its position, so it moves when the rows around it move. */
export function isDerived(type: FieldType): boolean {
	return capabilityOf(type).derived;
}

export function isReadOnly(type: FieldType): boolean {
	return capabilityOf(type).readOnly;
}

/**
 * Only where the reader fills the cell in: a derived column or a `noteProp` reading
 * another file's frontmatter would never fire the warning.
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

/** An empty value reads as nothing whatever its type, so an unticked box copies as empty text. */
export function formatCell(field: Field, value: CellValue): string {
	if (isEmptyCell(value)) {
		return '';
	}
	return SPECS[field.type].toText(field, value);
}

/** JSON rather than a join: a set and the string of its ids must not read back the same. */
export function serializeCellValue(value: CellValue): string {
	if (typeof value === 'string') {
		return value;
	}
	return JSON.stringify(value);
}

/**
 * Text that parses to something other than an array (`"5"`, `"true"`, `"{}"`) is a
 * hand-written list, not an empty cell: answering [] would lose what was written.
 */
function parseIds(raw: string): string[] {
	try {
		const parsed: unknown = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			return optionIds(parsed as CellValue);
		}
	} catch {
		// Not JSON at all, so it is a list of ids written out by hand.
	}
	return raw
		.split(',')
		.map((part) => part.trim())
		.filter((part) => part !== '');
}

export function deserializeCellValue(raw: string, field: Field): CellValue {
	if (field.type === 'multiSelect' || field.type === 'relation') {
		return parseIds(raw);
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

/** The text the view supplied wins when there is one, so a copy cannot drift from the screen. */
export function copyTextFor(
	field: Field,
	value: CellValue,
	computed?: string,
): string {
	if (computed !== undefined) {
		return computed;
	}
	if (readsFromView(field.type)) {
		// Copying the stored value would put an id on the clipboard; empty is honest.
		return '';
	}
	return cellToText(field, value);
}