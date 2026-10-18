import type { CellValue, Field, GridView, LayerDoc, LayerRecord } from '../types';
import { generateId } from '../utils/id';
import type { FormattedCell } from './clipboard';
import { forgetFieldSize, forgetRecordSize } from './layout';
import {cellFromText, emptyValueFor, isEmptyCell, optionIds, usesOptions} from './fields';

export function findRecord(
	doc: LayerDoc,
	recordId: string,
): LayerRecord | undefined {
	return doc.records.find((r) => r.id === recordId);
}

export function setCellValue(
	doc: LayerDoc,
	recordId: string,
	field: Field,
	value: CellValue,
): boolean {
	const record = findRecord(doc, recordId);
	if (!record) {
		return false;
	}
	if (!matchesFieldShape(field, value)) {
		// A wrong shape would be written out and read back as garbage.
		return false;
	}
	if (isEmptyCell(value)) {
		delete record.cells[field.id];
	} else {
		record.cells[field.id] = value;
	}
	return true;
}

/**
 * Whether a value has the shape this field's type stores. Enforced, not assumed:
 * the value can come from a paste, a hand-edited file, or a caller that still
 * thinks every cell is a string.
 */
function matchesFieldShape(field: Field, value: CellValue): boolean {
	switch (field.type) {
		case 'relationBack':
			// Derived, never stored: there is no value a caller could set here.
			return false;
		case 'multiSelect':
		case 'relation':
			return Array.isArray(value);
		case 'checkbox':
			return typeof value === 'boolean';
		case 'number':
			// `''` is how an empty number cell is cleared.
			return typeof value === 'number' || value === '';
		case 'select':
		case 'text':
		case 'longtext':
		case 'date':
		case 'datetime':
			return typeof value === 'string';
	}
}

export function setCellFromText(
	doc: LayerDoc,
	recordId: string,
	field: Field,
	text: string,
): boolean {
	const parsed = cellFromText(field, text);
	if (!parsed.ok) {
		return false;
	}
	return setCellValue(doc, recordId, field, parsed.value);
}

export function addRecord(doc: LayerDoc): LayerRecord {
	return insertRecordAt(doc, doc.records.length);
}

/** Inserts at the top of the board, above everything already there. */
export function addRecordAtTop(doc: LayerDoc): LayerRecord {
	return insertRecordAt(doc, 0);
}

function forgetRecordSizeFromViews(doc: LayerDoc, recordId: string): void {
	for (const view of doc.views) {
		if (view.type === 'grid') {
			forgetRecordSize(view, recordId);
		}
	}
}

export function insertRecordAfter(
	doc: LayerDoc,
	recordId: string,
): LayerRecord {
	const index = doc.records.findIndex((r) => r.id === recordId);
	return insertRecordAt(doc, index === -1 ? doc.records.length : index + 1);
}

export function insertRecordsAfter(
	doc: LayerDoc,
	recordId: string,
	count: number,
): LayerRecord[] {
	const index = doc.records.findIndex((r) => r.id === recordId);
	const start = index === -1 ? doc.records.length : index + 1;
	const inserted: LayerRecord[] = [];
	for (let offset = 0; offset < count; offset++) {
		inserted.push(insertRecordAt(doc, start + offset));
	}
	return inserted;
}

export function removeRecords(
	doc: LayerDoc,
	recordIds: readonly string[],
): number {
	let removed = 0;
	for (const id of recordIds) {
		if (removeRecord(doc, id)) {
			removed++;
		}
	}
	return removed;
}

export function duplicateRecords(
	doc: LayerDoc,
	recordIds: readonly string[],
): number {
	let made = 0;
	for (const id of recordIds) {
		if (duplicateRecord(doc, id)) {
			made++;
		}
	}
	return made;
}

function insertRecordAt(doc: LayerDoc, index: number): LayerRecord {	const record: LayerRecord = {
	id: generateId('r'),
	created: new Date().toISOString(),
	cells: {},
};
	doc.records.splice(index, 0, record);
	return record;
}

export function clearCells(
	doc: LayerDoc,
	recordIds: readonly string[],
	fields: readonly Field[],
): number {
	let cleared = 0;
	for (const recordId of recordIds) {
		for (const field of fields) {
			const record = findRecord(doc, recordId);
			if (record && field.id in record.cells) {
				// The empty value for this type: `[]` or `false`, never `''`.
				setCellValue(doc, recordId, field, emptyValueFor(field));
				cleared++;
			}
		}
	}
	return cleared;
}

export interface PasteReport {
	written: number;
	refused: number;
}

export function pasteCells(
	doc: LayerDoc,
	recordIds: readonly string[],
	fields: readonly Field[],
	rows: readonly (readonly string[])[],
): PasteReport {
	let written = 0;
	let refused = 0;

	for (const [rowIndex, recordId] of recordIds.entries()) {
		for (const [columnIndex, field] of fields.entries()) {
			const text = rows[rowIndex]?.[columnIndex];
			if (text === undefined) {
				continue;
			}
			if (setCellFromText(doc, recordId, field, text)) {
				written++;
			} else {
				refused++;
			}
		}
	}

	return { written, refused };
}

export function pasteFormatted(
	doc: LayerDoc,
	recordIds: readonly string[],
	fields: readonly Field[],
	rows: readonly (readonly FormattedCell[])[],
): PasteReport {
	let written = 0;
	let refused = 0;

	for (const [rowIndex, recordId] of recordIds.entries()) {
		for (const [columnIndex, field] of fields.entries()) {
			const source = rows[rowIndex]?.[columnIndex];
			if (source === undefined) {
				continue;
			}
			if (source.type !== field.type) {
				refused++;
				continue;
			}

			const value =
				field.type === 'select'
					? resolveOption(field, source)
					: field.type === 'multiSelect'
						? resolveOptionSet(field, source)
						: field.type === 'checkbox'
							? ({ ok: true, value: source.value === true } as const)
							: ({ ok: true, value: source.value } as const);
			if (!value.ok) {
				refused++;
				continue;
			}
			if (setCellValue(doc, recordId, field, value.value)) {
				written++;
			} else {
				refused++;
			}
		}
	}

	return { written, refused };
}

function resolveOption(
	field: Field,
	source: FormattedCell,
): { ok: true; value: CellValue } | { ok: false } {
	if (field.options?.some((option) => option.id === source.value)) {
		return { ok: true, value: source.value };
	}
	return cellFromText(field, source.text);
}

/** The set form of `resolveOption`: ids this field still knows, else the text. */
function resolveOptionSet(
	field: Field,
	source: FormattedCell,
): { ok: true; value: CellValue } | { ok: false } {
	const known = optionIds(source.value).filter((id) =>
		field.options?.some((option) => option.id === id),
	);
	if (known.length > 0) {
		return { ok: true, value: known };
	}
	return cellFromText(field, source.text);
}

export function removeRecord(doc: LayerDoc, recordId: string): boolean {
	const index = doc.records.findIndex((r) => r.id === recordId);
	if (index === -1) {
		return false;
	}
	doc.records.splice(index, 1);
	forgetRecordSizeFromViews(doc, recordId);
	return true;
}

export function duplicateRecord(
	doc: LayerDoc,
	recordId: string,
): LayerRecord | null {
	const index = doc.records.findIndex((r) => r.id === recordId);
	const source = doc.records[index];
	if (index === -1 || !source) {
		return null;
	}

	const copy: LayerRecord = {
		id: generateId('r'),
		created: new Date().toISOString(),
		cells: {...source.cells},
	};
	doc.records.splice(index + 1, 0, copy);
	return copy;
}

export function clearRecord(doc: LayerDoc, recordId: string): boolean {
	const record = findRecord(doc, recordId);
	if (!record) {
		return false;
	}
	record.cells = {};
	return true;
}

export function duplicateField(doc: LayerDoc, fieldId: string): Field | null {
	const index = doc.fields.findIndex((f) => f.id === fieldId);
	const source = doc.fields[index];
	if (index === -1 || !source) {
		return null;
	}
	const copy: Field = {
		id: generateId('f'),
		name: `${source.name} copy`,
		type: source.type,
	};
	if (source.options) {
		copy.options = source.options.map((o) => ({ ...o, id: generateId('o') }));
	}
	if (source.required) {
		copy.required = true;
	}
	if (source.frontmatterKey) {
		copy.frontmatterKey = source.frontmatterKey;
	}
	if (source.numberFormat) {
		copy.numberFormat = source.numberFormat;
	}
	if (source.decimals !== undefined) {
		copy.decimals = source.decimals;
	}
	if (source.min !== undefined) {
		copy.min = source.min;
	}
	if (source.max !== undefined) {
		copy.max = source.max;
	}
	if (source.linkPath) {
		copy.linkPath = source.linkPath;
	}
	if (source.linkFieldId) {
		copy.linkFieldId = source.linkFieldId;
	}
	if (source.backPath) {
		copy.backPath = source.backPath;
	}
	if (source.backFieldId) {
		copy.backFieldId = source.backFieldId;
	}
	if (source.backTitleFieldId) {
		copy.backTitleFieldId = source.backTitleFieldId;
	}
	doc.fields.splice(index + 1, 0, copy);
	return copy;
}

export function removeField(doc: LayerDoc, fieldId: string): boolean {
	const index = doc.fields.findIndex((f) => f.id === fieldId);
	if (index === -1) {
		return false;
	}
	const [removed] = doc.fields.splice(index, 1);

	for (const record of doc.records) {
		delete record.cells[fieldId];
	}

	for (let i = 0; i < doc.views.length; i++) {
		const view = doc.views[i];
		if (!view) {
			continue;
		}
		view.hiddenFieldIds = view.hiddenFieldIds.filter((id) => id !== fieldId);
		view.sorts = view.sorts.filter((s) => s.fieldId !== fieldId);
		view.filter.conditions = view.filter.conditions.filter(
			(c) => c.fieldId !== fieldId,
		);
		if (view.type === 'grid') {
			forgetFieldSize(view, fieldId);
		}
		if (view.type !== 'kanban') {
			continue;
		}
		view.cardFieldIds = view.cardFieldIds.filter((id) => id !== fieldId);
		if (view.groupByFieldId !== fieldId) {
			continue;
		}
		const replacement = doc.fields.find((f) => f.type === 'select');
		if (replacement) {
			view.groupByFieldId = replacement.id;
		} else {
			const demoted: GridView = {
				id: view.id,
				name: view.name,
				type: 'grid',
				filter: view.filter,
				sorts: view.sorts,
				hiddenFieldIds: view.hiddenFieldIds,
				columnWidths: {},
				rowHeights: {},
			};
			doc.views[i] = demoted;
		}
	}

	if (removed?.primary) {
		const next = doc.fields.find((f) => f.type === 'text') ?? doc.fields[0];
		if (next) {
			next.primary = true;
		}
	}

	return true;
}

export function addField(doc: LayerDoc, field: Field): Field {
	return insertFieldAt(doc, doc.fields.length, field);
}

export function insertFieldAfter(
	doc: LayerDoc,
	afterFieldId: string,
	field: Field,
): Field {
	const index = doc.fields.findIndex((f) => f.id === afterFieldId);
	return insertFieldAt(doc, index === -1 ? doc.fields.length : index + 1, field);
}

function insertFieldAt(doc: LayerDoc, index: number, field: Field): Field {
	doc.fields.splice(index, 0, field);
	if (doc.fields.length === 1) {
		field.primary = true;
	}
	return field;
}

export function moveFieldBefore(
	doc: LayerDoc,
	fieldId: string,
	beforeFieldId: string | null,
): boolean {
	const from = doc.fields.findIndex((f) => f.id === fieldId);
	if (from === -1) {
		return false;
	}
	if (beforeFieldId === fieldId) {
		return false;
	}

	const [field] = doc.fields.splice(from, 1);
	if (!field) {
		return false;
	}

	if (beforeFieldId === null) {
		doc.fields.push(field);
		return true;
	}

	const to = doc.fields.findIndex((f) => f.id === beforeFieldId);
	if (to === -1) {
		doc.fields.splice(from, 0, field);
		return false;
	}
	doc.fields.splice(to, 0, field);
	return true;
}

/** Removes every value in one field, and says how many there were. */
export function clearFieldCells(doc: LayerDoc, fieldId: string): number {
	let cleared = 0;
	for (const record of doc.records) {
		if (fieldId in record.cells) {
			delete record.cells[fieldId];
			cleared++;
		}
	}
	return cleared;
}

export function changeFieldType(
	doc: LayerDoc,
	fieldId: string,
	nextType: Field['type'],
): number {
	const field = doc.fields.find((f) => f.id === fieldId);
	if (!field || field.type === nextType) {
		return 0;
	}

	const dropped = clearFieldCells(doc, fieldId);

	field.type = nextType;
	if (usesOptions(nextType)) {
		field.options ??= [];
	} else {
		delete field.options;
	}
	// The number settings would be meaningless on another type, so they go with it.
	if (nextType !== 'number') {
		delete field.numberFormat;
		delete field.decimals;
		delete field.min;
		delete field.max;
	}
	// Same for a relation's target, which no other type can use.
	if (nextType !== 'relation') {
		delete field.linkPath;
		delete field.linkFieldId;
	}
	if (nextType !== 'relationBack') {
		delete field.backPath;
		delete field.backFieldId;
		delete field.backTitleFieldId;
	}

	return dropped;
}
