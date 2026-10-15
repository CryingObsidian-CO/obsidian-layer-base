import type {CellValue, Field, FieldType, SelectOption} from '../types';

/**
 * Per-type behaviour for the fields a board can hold.
 *
 * One spec per type, and every operation that depends on what a value *means*
 * goes through it: how to write it as text, and how to read text back. The grid,
 * the editors and the clipboard therefore never branch on the type themselves —
 * adding a type means adding a spec, not editing call sites.
 *
 * This matters for `select` in particular. Its values are option *ids*, so
 * copying one as text has to resolve the id to a name, and pasting has to
 * resolve a name back to an id. A generic "copy the value" would put `o_1` on
 * the clipboard and paste nothing useful.
 *
 * Only the operations that exist are declared. `defaultValue`, comparison and
 * cloning were here before and are gone with the types that needed them; a type
 * that requires one adds it back alongside itself.
 *
 * Deliberately free of any Obsidian import, so it stays a pure module that tests
 * can exercise directly. Type *names* for the UI are not here either: those are
 * user-facing text and live in the i18n catalogue.
 */
export interface FieldTypeSpec {
	readonly type: FieldType;
	/** Lucide icon id. Obsidian renders nothing for an unknown id, so a wrong
	 * name degrades to a missing icon rather than an error. */
	readonly icon: string;

	/** Plain text for the clipboard, as a person would expect to paste it. */
	toText(field: Field, value: CellValue): string;

	/**
	 * Reads clipboard text as a value of this type.
	 *
	 * `ok: false` means the text does not fit the type — a name that matches no
	 * option, for instance. It is a distinct outcome from an empty value, which
	 * legitimately clears the cell, and conflating the two is why this returns a
	 * result object rather than a nullable value.
	 */
	fromText(field: Field, text: string): TextParseResult;
}

export type TextParseResult = {ok: true; value: CellValue} | {ok: false};

const REFUSED: TextParseResult = {ok: false};

function accept(value: CellValue): TextParseResult {
	return {ok: true, value};
}

/** Options are matched by name, ignoring case and surrounding space. */
function optionByName(field: Field, name: string): SelectOption | undefined {
	const wanted = name.trim().toLowerCase();
	return field.options?.find((o) => o.name.trim().toLowerCase() === wanted);
}

const SPECS: Record<FieldType, FieldTypeSpec> = {
	text: {
		type: 'text',
		icon: 'type',
		// Text is already the clipboard's own currency.
		toText: (_field, value) => value,
		fromText: (_field, text) => accept(text),
	},

	select: {
		type: 'select',
		icon: 'circle',
		// The option's name, not its id: an id is meaningless outside this file.
		toText: (field, value) =>
			field.options?.find((o) => o.id === value)?.name ?? '',
		fromText: (field, text) => {
			if (text.trim() === '') {
				return accept('');
			}
			const option = optionByName(field, text);
			return option ? accept(option.id) : REFUSED;
		},
	},
};

/** Every supported type, in a stable order for menus and pickers. */
export const FIELD_TYPES: readonly FieldType[] = ['text', 'select'];

export function specFor(type: FieldType): FieldTypeSpec {
	return SPECS[type];
}

/** True when the type stores option ids rather than free text. */
export function usesOptions(type: FieldType): boolean {
	return type === 'select';
}

/** Whether a value counts as "nothing is here". */
export function isEmptyCell(value: CellValue): boolean {
	return value === '';
}

/** The clipboard text for one cell. */
export function cellToText(field: Field, value: CellValue): string {
	return SPECS[field.type].toText(field, value);
}

/** Reads clipboard text as a value for `field`, or refuses it. */
export function cellFromText(field: Field, text: string): TextParseResult {
	return SPECS[field.type].fromText(field, text);
}

/**
 * The display text for a cell.
 *
 * A select value is resolved to its option's name, so a cell shows "Done" rather
 * than the stored option id. An id with no matching option falls back to the raw
 * id on purpose: a dangling reference is a data problem, and hiding it would
 * make the column look empty instead of visibly wrong.
 */
export function formatCell(field: Field, value: CellValue): string {
	if (isEmptyCell(value)) {
		return '';
	}
	if (field.type === 'select') {
		return field.options?.find((o) => o.id === value)?.name ?? value;
	}
	return value;
}

/** The record's display title: the value of the primary field. */
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
