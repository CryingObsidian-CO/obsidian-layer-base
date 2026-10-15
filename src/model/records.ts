import type { CellValue, Field, GridView, LayerDoc, LayerRecord } from '../types';
import { generateId } from '../utils/id';
import type { FormattedCell } from './clipboard';
import { forgetFieldSize, forgetRecordSize } from './layout';
import {cellFromText, isEmptyCell, usesOptions} from './fields';

/**
 * Record and cell mutation.
 *
 * These functions mutate the document in place. The view owns exactly one
 * `LayerDoc` per open file and hands it to `getViewData()` when Obsidian saves,
 * so replacing the object would mean re-threading it through every caller for no
 * benefit. Mutation is safe here because nothing else holds a reference to a
 * previous revision.
 */

export function findRecord(
	doc: LayerDoc,
	recordId: string,
): LayerRecord | undefined {
	return doc.records.find((r) => r.id === recordId);
}

/**
 * Writes one cell, or clears it when the value is empty.
 *
 * Clearing *removes* the key rather than storing `''`, `null` or `[]`. That
 * matters because the parser normalises blanks away on read, so storing them
 * would make a file change shape on every save/reload cycle — the same cell
 * would be present in memory and absent after a round trip.
 *
 * Returns false when the record no longer exists, which can happen if an edit
 * lands after the row was deleted.
 */
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
	if (isEmptyCell(value)) {
		delete record.cells[field.id];
	} else {
		record.cells[field.id] = value;
	}
	return true;
}

/**
 * Applies clipboard text to one cell.
 *
 * The text is read by the field's own spec, so a name is matched back to an
 * option id for a `select` and `"42"` becomes a number. Returns false when the
 * text does not fit the type, which the caller surfaces rather than silently
 * leaving the cell as it was.
 */
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

/** Appends a blank record and returns it. */
export function addRecord(doc: LayerDoc): LayerRecord {
	return insertRecordAt(doc, doc.records.length);
}

/** Drops the stored row height for a record across every table view. */
function forgetRecordSizeFromViews(doc: LayerDoc, recordId: string): void {
	for (const view of doc.views) {
		if (view.type === 'grid') {
			forgetRecordSize(view, recordId);
		}
	}
}

/**
 * Inserts a blank record directly after `recordId`.
 *
 * "Insert below" is what a row action means in a table: the new row should
 * appear where the user is looking. Appending to the end would put it out of
 * sight on a long board.
 *
 * Falls back to appending when the anchor is gone.
 */
export function insertRecordAfter(
	doc: LayerDoc,
	recordId: string,
): LayerRecord {
	const index = doc.records.findIndex((r) => r.id === recordId);
	return insertRecordAt(doc, index === -1 ? doc.records.length : index + 1);
}

/**
 * Inserts several blank rows directly below a record.
 *
 * A selection of three rows asks for three rows, not one. Inserting a single
 * row and leaving the rest of the selection untouched answers a question nobody
 * asked — the same mistake the range menu once made by acting on `recordIds[0]`
 * while its own label promised otherwise.
 */
export function insertRecordsAfter(
	doc: LayerDoc,
	recordId: string,
	count: number,
): LayerRecord[] {
	const index = doc.records.findIndex((r) => r.id === recordId);
	const start = index === -1 ? doc.records.length : index + 1;
	const inserted: LayerRecord[] = [];
	for (let offset = 0; offset < count; offset++) {
		// Successive offsets keep the new rows in order; inserting repeatedly at
		// the same position would have stacked them backwards.
		inserted.push(insertRecordAt(doc, start + offset));
	}
	return inserted;
}

/** Removes several records, reporting how many were actually there. */
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

/**
 * Duplicates several records, each copy landing directly below its source.
 *
 * Copies are made one at a time and located by id rather than by position, so
 * the rows being inserted cannot shift the ones still to be copied.
 */
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

/**
 * Empties every cell of a set of records for a set of fields.
 *
 * Used by the range menu. Clearing goes through `setCellValue` rather than
 * deleting keys directly so that "empty" keeps its single representation.
 *
 * Returns how many cells actually held something.
 */
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
				setCellValue(doc, recordId, field, '');
				cleared++;
			}
		}
	}
	return cleared;
}

/**
 * Writes a grid of clipboard text into a rectangle of cells, one text value per
 * cell.
 *
 * The caller resolves the rectangle to concrete ids, so this takes positions
 * rather than a selection: the grid's idea of "row 2" is a rendered position,
 * and the model should not need to know about hidden columns.
 *
 * `text` is read by each target field's own spec, because the destination
 * decides how a value is interpreted — pasting "Done" into a text column stores
 * the word, and into a select column stores the matching option id.
 *
 * Returns what happened, so the caller can report partial failures instead of
 * claiming a paste worked when some cells refused it.
 */
export interface PasteReport {
	written: number;
	/** Cells whose text did not fit the column's type. */
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
			// A pasted block larger than the target is clipped; a smaller one
			// leaves the remaining cells alone rather than clearing them, which
			// is what a spreadsheet does when the source is narrower.
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

/**
 * Writes a formatted payload into a rectangle of cells.
 *
 * A cell is written only when its column's type matches the type the value was
 * copied from. That is the whole point of a formatted copy: a select holds an
 * option id, and putting that id — or the option's name — into a text column
 * would store something that looks like data but is not the thing that was
 * copied. A mismatch is refused and counted rather than converted.
 *
 * A select pasted into a *different* select column is the interesting case.
 * Option ids belong to a field, so the id from the source may mean nothing in the
 * destination. The id is used when the destination knows it, and otherwise the
 * cell's displayed text is resolved against the destination's options — which is
 * what makes copying "Done" between two boards do the obvious thing instead of
 * writing a dangling id.
 *
 * Returns what happened, so the caller can report it instead of claiming a paste
 * worked when every cell refused it.
 */
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

/**
 * Finds the destination's own option for a copied select value.
 *
 * The id first, because a paste back into the same column should be exact. The
 * displayed text second, for a paste into another column whose options are a
 * different set of ids. Nothing third — an option the destination does not have
 * cannot be invented here.
 */
function resolveOption(
	field: Field,
	source: FormattedCell,
): { ok: true; value: CellValue } | { ok: false } {
	if (field.options?.some((option) => option.id === source.value)) {
		return { ok: true, value: source.value };
	}
	return cellFromText(field, source.text);
}

/** Removes a record. Returns false when it was already gone. */
export function removeRecord(doc: LayerDoc, recordId: string): boolean {
	const index = doc.records.findIndex((r) => r.id === recordId);
	if (index === -1) {
		return false;
	}
	doc.records.splice(index, 1);
	// The row's stored height is unreachable now, but it would apply again if
	// this id were ever reused.
	forgetRecordSizeFromViews(doc, recordId);
	return true;
}

/**
 * Copies a record, values included, and inserts it after the original.
 *
 * `created` is deliberately refreshed rather than copied: it records when this
 * row came into existence, and the copy is a new row. Carrying the original's
 * timestamp over would claim it is older than it is.
 *
 * The shallow copy of `cells` is safe because every value is a string, which is
 * immutable. A type storing an array or object will need a real clone here — the
 * earlier multiSelect type shared its array with the duplicate, so editing the
 * copy silently rewrote the row it came from.
 *
 * Returns the new record, or null when the source is gone.
 */
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

/**
 * Empties every cell of a record while keeping the row.
 *
 * Distinct from deleting: a blank row is a placeholder someone intends to fill,
 * and removing it instead would be a destructive answer to a non-destructive
 * request.
 *
 * Returns false when the record is gone.
 */
export function clearRecord(doc: LayerDoc, recordId: string): boolean {
	const record = findRecord(doc, recordId);
	if (!record) {
		return false;
	}
	record.cells = {};
	return true;
}

/**
 * Copies a field's definition, without its values, and inserts it after the
 * original.
 *
 * Values are excluded on purpose: duplicating a column is how someone starts a
 * related column ("Status" → "Previous status"), and copying every cell would
 * produce two identical columns that then have to be cleared by hand.
 *
 * Returns the new field, or null when the source is gone.
 */
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
		// Option ids are regenerated along with the field, so the copy's cells
		// can never collide with the original's.
		copy.options = source.options.map((o) => ({ ...o, id: generateId('o') }));
	}
	if (source.frontmatterKey) {
		copy.frontmatterKey = source.frontmatterKey;
	}
	doc.fields.splice(index + 1, 0, copy);
	return copy;
}

/**
 * Deletes a field and every reference to it.
 *
 * The cascade is the whole reason this lives in the model rather than in the
 * dialog that triggers it. A field id appears in six places — each record's
 * cells, each view's hidden list, sorts, filter conditions, a board's group
 * field, and a board's card list — and missing any one leaves a dangling
 * reference that the parser will silently drop on the next read. Cleaning up
 * here means deletion has one definition and can be tested directly.
 *
 * Returns false when the field was not found.
 */
/** Removes a field. Returns false when it was not found. */
export function removeField(doc: LayerDoc, fieldId: string): boolean {
	const index = doc.fields.findIndex((f) => f.id === fieldId);
	if (index === -1) {
		return false;
	}
	const [removed] = doc.fields.splice(index, 1);

	for (const record of doc.records) {
		delete record.cells[fieldId];
	}

	// Views are rebuilt by index rather than mutated in a `for...of`, because a
	// board whose grouping field disappears is replaced wholesale.
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
		// A board cannot group by a column that no longer exists. Point it at
		// another option field, or demote it to a table if there is none —
		// leaving it broken would make the view fail to render.
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
				// A board has no column or row sizes to carry over.
				columnWidths: {},
				rowHeights: {},
			};
			doc.views[i] = demoted;
		}
	}

	// A board always needs exactly one primary field to display records by.
	if (removed?.primary) {
		const next = doc.fields.find((f) => f.type === 'text') ?? doc.fields[0];
		if (next) {
			next.primary = true;
		}
	}

	return true;
}

/** Appends a field and returns it. */
export function addField(doc: LayerDoc, field: Field): Field {
	return insertFieldAt(doc, doc.fields.length, field);
}

/**
 * Inserts a field directly after `afterFieldId`.
 *
 * Matches the row case: "insert after this column" must place it where the user
 * is looking, not at the far right of a wide board.
 *
 * Falls back to appending when the anchor is gone.
 */
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
	// The first field on an empty board must be the primary one, or records
	// would have no title.
	if (doc.fields.length === 1) {
		field.primary = true;
	}
	return field;
}

/**
 * Moves a field to sit immediately before another one.
 *
 * Order is global rather than per view: a field's position is part of the schema,
 * and the board view lists card fields in the same order, so a rearrangement is
 * a change to the data rather than to one way of looking at it.
 *
 * The destination is given as a *field id* rather than a slot number. That is
 * what makes the drag land correctly when some columns are hidden: the visible
 * columns are not adjacent in `fields`, and counting visible slots would shuffle
 * the hidden ones to the end. Anchoring on a real neighbour leaves them alone.
 *
 * `beforeFieldId` of null appends to the end.
 *
 * Returns false when the moved field is unknown, or when the anchor is unknown —
 * in which case the order is left exactly as it was.
 */
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

	// Looked up after the removal, so the index reflects the shortened array.
	const to = doc.fields.findIndex((f) => f.id === beforeFieldId);
	if (to === -1) {
		// Put it back where it was rather than silently dropping it.
		doc.fields.splice(from, 0, field);
		return false;
	}
	doc.fields.splice(to, 0, field);
	return true;
}

/**
 * Changes a field's type, clearing the values it can no longer hold.
 *
 * No conversion is possible between the two supported types: `text` keeps free
 * text, while `select` keeps option ids, and neither value means anything in the
 * other. Rather than pretend, every value is dropped and counted, so the caller
 * can tell the user exactly how much was cleared.
 *
 * Returns the number of cells that were emptied.
 */
export function changeFieldType(
	doc: LayerDoc,
	fieldId: string,
	nextType: Field['type'],
): number {
	const field = doc.fields.find((f) => f.id === fieldId);
	if (!field || field.type === nextType) {
		return 0;
	}

	let dropped = 0;
	for (const record of doc.records) {
		if (fieldId in record.cells) {
			delete record.cells[fieldId];
			dropped++;
		}
	}

	field.type = nextType;
	// Options only mean something for a select column. Keeping them while
	// switching to text would leave ids in the file that nothing renders.
	if (usesOptions(nextType)) {
		field.options ??= [];
	} else {
		delete field.options;
	}

	return dropped;
}
