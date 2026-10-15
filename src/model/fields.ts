import type {CellValue, Field, FieldType, SelectOption} from '../types';

export interface FieldTypeSpec {
	readonly type: FieldType;
	readonly icon: string;

	toText(field: Field, value: CellValue): string;

	fromText(field: Field, text: string): TextParseResult;
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

const SPECS: Record<FieldType, FieldTypeSpec> = {
	text: {
		type: 'text',
		icon: 'type',
		toText: (_field, value) => value,
		fromText: (_field, text) => accept(text),
	},

	select: {
		type: 'select',
		icon: 'circle',
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

export const FIELD_TYPES: readonly FieldType[] = ['text', 'select'];

export function specFor(type: FieldType): FieldTypeSpec {
	return SPECS[type];
}

export function usesOptions(type: FieldType): boolean {
	return type === 'select';
}

export function isEmptyCell(value: CellValue): boolean {
	return value === '';
}

export function cellToText(field: Field, value: CellValue): string {
	return SPECS[field.type].toText(field, value);
}

export function cellFromText(field: Field, text: string): TextParseResult {
	return SPECS[field.type].fromText(field, text);
}

export function formatCell(field: Field, value: CellValue): string {
	if (isEmptyCell(value)) {
		return '';
	}
	if (field.type === 'select') {
		return field.options?.find((o) => o.id === value)?.name ?? value;
	}
	return value;
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
