import type {
	CellValue,
	Field,
	FilterCondition,
	GridView,
	LayerDoc,
	LayerRecord,
} from '../types';
import { generateId } from '../utils/id';
import type { FormattedCell } from './clipboard';
import { forgetFieldSize, forgetRecordSize } from './layout';
import { acceptsValue } from './capabilities';
import { operatorsFor } from './filter';
import {
	cellFromText,
	emptyValueFor,
	isEmptyCell,
	optionIds,
	usesOptions,
} from './fields';


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
 * Enforced, not assumed: the value can come from a paste, a hand-edited file, or a caller that
 * still thinks every cell is a string.
 */
function matchesFieldShape(field: Field, value: CellValue): boolean {
	return acceptsValue(field.type, value);
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

function insertRecordAt(doc: LayerDoc, index: number): LayerRecord {
	const record: LayerRecord = {
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

/**
 * A second column configured like this one, copied by spread so a new `Field` setting arrives
 * without being listed. The id, `primary` and `frontmatterKey` are deliberately not copied.
 */
export function duplicateField(doc: LayerDoc, fieldId: string): Field | null {
	const index = doc.fields.findIndex((f) => f.id === fieldId);
	const source = doc.fields[index];
	if (index === -1 || !source) {
		return null;
	}
	const copy: Field = {
		...source,
		id: generateId('f'),
		name: `${source.name} copy`,
	};
	delete copy.primary;
	delete copy.frontmatterKey;
	if (source.options) {
		copy.options = source.options.map((option) => ({ ...option, id: generateId('o') }));
	}
	doc.fields.splice(index + 1, 0, copy);
	return copy;
}

/**
 * Settings that name another column by id; a deleted column must be forgotten by all of them, or
 * a relation draws empty and a rollup has no source.
 */
const FIELD_REFERENCES = [
	'linkFieldId',
	'backFieldId',
	'backTitleFieldId',
	'rollupSourceFieldId',
	'rollupFieldId',
	'lookupSourceFieldId',
	'lookupFieldId',
	'numberGroupFieldId',
	'noteFieldId',
] as const;

export function removeField(doc: LayerDoc, fieldId: string): boolean {
	const index = doc.fields.findIndex((f) => f.id === fieldId);
	if (index === -1) {
		return false;
	}
	const [removed] = doc.fields.splice(index, 1);

	for (const record of doc.records) {
		delete record.cells[fieldId];
	}

	for (const field of doc.fields) {
		for (const key of FIELD_REFERENCES) {
			if (field[key] === fieldId) {
				delete field[key];
			}
		}
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
			// A tint names the column it reads, and so does a footer.
			if (view.colorRules) {
				view.colorRules = view.colorRules.filter((rule) => rule.fieldId !== fieldId);
				if (view.colorRules.length === 0) {
					delete view.colorRules;
				}
			}
			if (view.summaries) {
				delete view.summaries[fieldId];
				if (Object.keys(view.summaries).length === 0) {
					delete view.summaries;
				}
			}
		}
		if (view.type !== 'kanban') {
			continue;
		}
		view.cardFieldIds = view.cardFieldIds.filter((id) => id !== fieldId);
		// Without a title column a card falls back to the table's primary column.
		if (view.titleFieldId === fieldId) {
			delete view.titleFieldId;
		}
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
	if (nextType !== 'number') {
		delete field.numberFormat;
		delete field.decimals;
		delete field.min;
		delete field.max;
	}
	if (nextType !== 'relation') {
		delete field.linkPath;
		delete field.linkFieldId;
	}
	if (nextType !== 'relationBack') {
		delete field.backPath;
		delete field.backFieldId;
		delete field.backTitleFieldId;
	}
	if (nextType !== 'formula') {
		delete field.formula;
		delete field.formulaType;
	}
	if (nextType !== 'autoNumber') {
		delete field.numberLength;
		delete field.numberGroupFieldId;
	}
	if (nextType !== 'rollup') {
		delete field.rollupSourceFieldId;
		delete field.rollupFieldId;
		delete field.rollupAggregate;
	}
	if (nextType !== 'lookup') {
		delete field.lookupSourceFieldId;
		delete field.lookupFieldId;
	}
	// A note property reads one key of the note a note column points at; both belong to that type alone.
	if (nextType !== 'noteProp') {
		delete field.noteFieldId;
		delete field.frontmatterKey;
	}

	/*
	 * The comparisons a column offers change with its type ("is ticked" means nothing on text).
	 * A saved rule using an old comparison starts over on the new type's first, or it would
	 * answer "no" for every row and hide the whole table with no visible cause.
	 */
	const offered = operatorsFor(field);
	const rebase = (condition: FilterCondition): void => {
		if (condition.fieldId !== field.id || offered.includes(condition.operator)) {
			return;
		}
		condition.operator = offered[0] ?? 'is';
		delete condition.value;
	};
	for (const view of doc.views) {
		for (const condition of view.filter.conditions) {
			rebase(condition);
		}
		if (view.type === 'grid') {
			for (const rule of view.colorRules ?? []) {
				rebase(rule);
			}
		}
	}

	return dropped;
}