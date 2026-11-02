import {
	type CellValue,
	type ColorRule,
	type Field,
	type FieldType,
	type Filter,
	type FilterCondition,
	type FilterOperator,
	type KanbanView,
	LAYER_FORMAT_VERSION,
	type LayerDoc,
	type LayerRecord,
	type SelectOption,
	type Sort,
	type View,
} from '../types';
import {generateId} from '../utils/id';
import {FIELD_TYPES, isEmptyCell, usesOptions} from '../model/fields';
import {normaliseDate, normaliseDateTime} from '../model/date';
import {normaliseDecimals, parseNumber} from '../model/number';
import {clampRowHeight} from '../model/layout';
import {OPTION_PALETTE} from '../model/select-options';
import {migrate} from './migrate';

/**
 * Types this parser accepts, taken from the field registry rather than repeated
 * here.
 */
const KNOWN_FIELD_TYPES: ReadonlySet<string> = new Set(FIELD_TYPES);

const OPERATORS: ReadonlySet<string> = new Set([
	'is',
	'isNot',
	'contains',
	'notContains',
	'isEmpty',
	'isNotEmpty',
	'greaterThan',
	'lessThan',
	'checked',
	'unchecked',
]);

/** Problems found while parsing. The view surfaces these instead of losing data silently. */
export interface ParseResult {
	doc: LayerDoc;
	/** Human-readable notes; empty when the file parsed cleanly. */
	warnings: string[];
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = ''): string {
	return typeof value === 'string' ? value : fallback;
}

/**
 * Ids in the file are trusted only when they are usable.
 */
function normalizeId(
	value: unknown,
	prefix: string,
	seen: Set<string>,
	warnings?: string[],
): string {
	const candidate = typeof value === 'string' ? value.trim() : '';
	if (candidate && !seen.has(candidate)) {
		seen.add(candidate);
		return candidate;
	}

	// A regenerated id means any cell keyed by the old one is unreachable.
	warnings?.push(
		`Identifier "${candidate || '(empty)'}" is missing or duplicated and was regenerated; cells keyed by it may have been lost.`,
	);
	let id = generateId(prefix);
	while (seen.has(id)) {
		id = generateId(prefix);
	}
	seen.add(id);
	return id;
}

function parseOptions(
	raw: unknown,
	seen: Set<string>,
	warnings?: string[],
): SelectOption[] {
	const options: SelectOption[] = [];
	for (const item of asArray(raw)) {
		if (!isRecordObject(item)) {
			continue;
		}
		options.push({
			id: normalizeId(item.id, 'o', seen, warnings),
			name: asString(item.name),
			color: asString(item.color, 'default'),
		});
	}
	return options;
}

function parseField(
	raw: unknown,
	index: number,
	seen: Set<string>,
	warnings?: string[],
): Field | null {
	if (!isRecordObject(raw)) {
		return null;
	}
	const type = asString(raw.type);
	if (!KNOWN_FIELD_TYPES.has(type)) {
		return null;
	}
	const field: Field = {
		id: normalizeId(raw.id, 'f', seen, warnings),
		name: asString(raw.name, `Field ${index + 1}`),
		type: type as Field['type'],
	};
	if (raw.primary === true) {
		field.primary = true;
	}
	if (raw.required === true) {
		field.required = true;
	}
	if (typeof raw.frontmatterKey === 'string' && raw.frontmatterKey.trim()) {
		field.frontmatterKey = raw.frontmatterKey.trim();
	}
	if (typeof raw.noteFieldId === 'string' && raw.noteFieldId.trim()) {
		field.noteFieldId = raw.noteFieldId.trim();
	}
	// Asked of the model, not listed here: a type that stores choices by option id
	// must keep them through a save, or the next parse drops them and writes the
	// field back without them.
	if (usesOptions(field.type)) {
		field.options = parseOptions(raw.options, seen, warnings);
	}
	if (field.type === 'number') {
		parseNumberSettings(raw, field);
	}
	if (field.type === 'relation' || field.type === 'relationBack') {
		parseLinkSettings(raw, field);
	}
	if (field.type === 'formula') {
		const expression = asString(raw.formula);
		if (expression.trim() !== '') {
			field.formula = expression;
		}
		const declared = asString(raw.formulaType);
		if (declared === 'number' || declared === 'text' || declared === 'boolean') {
			field.formulaType = declared;
		}
	}
	if (field.type === 'autoNumber') {
		const length = raw.numberLength;
		if (typeof length === 'number' && Number.isFinite(length) && length >= 1) {
			field.numberLength = Math.min(Math.floor(length), 12);
		}
		const group = asString(raw.numberGroupFieldId);
		if (group !== '') {
			field.numberGroupFieldId = group;
		}
	}
	if (field.type === 'rollup') {
		const source = asString(raw.rollupSourceFieldId);
		if (source !== '') {
			field.rollupSourceFieldId = source;
		}
		const target = asString(raw.rollupFieldId);
		if (target !== '') {
			field.rollupFieldId = target;
		}
		const how = asString(raw.rollupAggregate);
		if (
			how === 'sum' ||
			how === 'average' ||
			how === 'min' ||
			how === 'max' ||
			how === 'count' ||
			how === 'countAll'
		) {
			field.rollupAggregate = how;
		}
	}
	if (field.type === 'lookup') {
		const source = asString(raw.lookupSourceFieldId);
		if (source !== '') {
			field.lookupSourceFieldId = source;
		}
		const target = asString(raw.lookupFieldId);
		if (target !== '') {
			field.lookupFieldId = target;
		}
	}
	return field;
}

/** The table-and-column pair behind a relation, in either direction. */
function parseLinkSettings(raw: Record<string, unknown>, field: Field): void {
	const back = field.type === 'relationBack';
	const pathKey = back ? 'backPath' : 'linkPath';
	const fieldKey = back ? 'backFieldId' : 'linkFieldId';
	// A blank path means this table, so it is left absent rather than written as
	// an empty string.
	const path = asString(raw[pathKey]).trim();
	if (path !== '') {
		field[pathKey] = path;
	}
	const fieldId = asString(raw[fieldKey]).trim();
	if (fieldId !== '') {
		field[fieldKey] = fieldId;
	}
	if (back) {
		const titleFieldId = asString(raw.backTitleFieldId).trim();
		if (titleFieldId !== '') {
			field.backTitleFieldId = titleFieldId;
		}
	}
}

/** The number settings, kept only where they differ from the plain defaults. */
function parseNumberSettings(raw: Record<string, unknown>, field: Field): void {
	if (raw.numberFormat === 'percent') {
		field.numberFormat = 'percent';
	}
	const decimals = normaliseDecimals(
		typeof raw.decimals === 'number' ? raw.decimals : undefined,
	);
	if (decimals !== null) {
		field.decimals = decimals;
	}
	for (const key of ['min', 'max'] as const) {
		const value = raw[key];
		if (typeof value === 'number' && Number.isFinite(value)) {
			field[key] = value;
		}
	}
}

/**
 * Coerces a stored cell into the shape the format uses, which is text.
 */
export function normalizeCellValue(raw: unknown): CellValue {
	if (typeof raw === 'string') {
		return raw;
	}
	if (typeof raw === 'number' && Number.isFinite(raw)) {
		return String(raw);
	}
	if (typeof raw === 'boolean') {
		return String(raw);
	}
	return '';
}

/**
 * Coerces a stored cell for the field that owns it, so the shape matches the
 * type: a set keeps its string ids, a checkbox keeps a real boolean. Anything
 * else is treated as absent, so a hand-edited file degrades to an empty cell
 * rather than putting a wrong shape into the grid.
 */
export function normalizeCellForField(raw: unknown, type: FieldType): CellValue {
	switch (type) {
		case 'multiSelect':
		case 'relation': {
			if (!Array.isArray(raw)) {
				return [];
			}
			const ids: string[] = [];
			for (const item of raw) {
				if (typeof item === 'string' && item !== '' && !ids.includes(item)) {
					ids.push(item);
				}
			}
			return ids;
		}
		case 'checkbox':
			return raw === true;
		case 'number':
		case 'autoNumber': {
			// Kept a number: text would lose the padding and read 1 where it says 01.
			if (typeof raw === 'number' && Number.isFinite(raw)) {
				return raw;
			}
			// A hand-edited file may hold the number as text; keep it if it parses.
			return typeof raw === 'string' ? (parseNumber(raw) ?? '') : '';
		}
		case 'date': {
			const text = typeof raw === 'string' ? normaliseDate(raw) : null;
			return text ?? '';
		}
		case 'datetime': {
			const text = typeof raw === 'string' ? normaliseDateTime(raw) : null;
			return text ?? '';
		}
		case 'relationBack':
		case 'formula':
			// Derived: a value written by hand is not kept, so it cannot drift out
			// of step with what it is computed from.
			return '';
		default:
			return normalizeCellValue(raw);
	}
}

function parseRecord(
	raw: unknown,
	fields: Field[],
	warnings: string[],
): LayerRecord | null {
	if (!isRecordObject(raw)) {
		return null;
	}
	if (!isRecordObject(raw.cells)) {
		return null;
	}

	const seen = new Set<string>();
	const id = normalizeId(raw.id, 'r', seen, warnings);
	const cellsSource = raw.cells;
	const cells: Record<string, CellValue> = {};

	// Only known fields are kept, and empty values are left out entirely.
	for (const field of fields) {
		if (!(field.id in cellsSource)) {
			continue;
		}
		const value = normalizeCellForField(cellsSource[field.id], field.type);
		if (!isEmptyCell(value)) {
			cells[field.id] = value;
		}
	}

	return {id, created: normalizeTimestamp(raw.created), cells};
}

export function normalizeTimestamp(raw: unknown): string {
	if (typeof raw === 'string') {
		const parsed = new Date(raw);
		if (!Number.isNaN(parsed.getTime())) {
			return raw;
		}
	}
	return nowIso();
}

function nowIso(): string {
	return new Date().toISOString();
}

function parseSorts(raw: unknown, fieldIds: Set<string>): Sort[] {
	const sorts: Sort[] = [];
	for (const item of asArray(raw)) {
		if (!isRecordObject(item)) {
			continue;
		}
		const fieldId = asString(item.fieldId);
		if (!fieldIds.has(fieldId)) {
			continue;
		}
		sorts.push({
			fieldId,
			order: item.order === 'desc' ? 'desc' : 'asc',
		});
	}
	return sorts;
}

function parseConditions(raw: unknown, fieldIds: Set<string>): FilterCondition[] {
	const conditions: FilterCondition[] = [];
	for (const item of asArray(raw)) {
		if (!isRecordObject(item)) {
			continue;
		}
		const fieldId = asString(item.fieldId);
		const operator = asString(item.operator);
		if (!fieldIds.has(fieldId) || !OPERATORS.has(operator)) {
			continue;
		}
		const value = item.value;
		if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
			conditions.push({
				fieldId,
				operator: operator as FilterOperator,
				value,
			});
		} else {
			conditions.push({
				fieldId,
				operator: operator as FilterOperator,
			});
		}
	}
	return conditions;
}

/**
 * The rules a view tints its rows by.
 *
 * A rule that names a column which is gone, or a colour this build does not have,
 * is dropped rather than kept: it could never paint anything, and keeping it
 * would leave a rule in the panel that does nothing when clicked.
 */
function parseColorRules(raw: unknown, fieldIds: Set<string>): ColorRule[] {
	const rules: ColorRule[] = [];
	for (const item of asArray(raw)) {
		if (!isRecordObject(item)) {
			continue;
		}
		const fieldId = asString(item.fieldId);
		const operator = asString(item.operator);
		const color = asString(item.color);
		if (
			!fieldIds.has(fieldId) ||
			!OPERATORS.has(operator) ||
			!OPTION_PALETTE.includes(color)
		) {
			continue;
		}
		const rule: ColorRule = {
			fieldId,
			operator: operator as FilterOperator,
			color,
		};
		const value = item.value;
		if (
			typeof value === 'string' ||
			typeof value === 'number' ||
			typeof value === 'boolean'
		) {
			rule.value = value;
		}
		rules.push(rule);
	}
	return rules;
}

function parseFilter(raw: unknown, fieldIds: Set<string>): Filter {
	if (!isRecordObject(raw)) {
		return {conjunction: 'and', conditions: []};
	}
	return {
		conjunction: raw.conjunction === 'or' ? 'or' : 'and',
		conditions: parseConditions(raw.conditions, fieldIds),
	};
}

function parseView(
	raw: unknown,
	index: number,
	fields: Field[],
	recordIds: ReadonlySet<string>,
	warnings?: string[],
): View | null {
	if (!isRecordObject(raw)) {
		return null;
	}
	const seen = new Set<string>();
	const id = normalizeId(raw.id, 'v', seen, warnings);
	const name = asString(raw.name, `View ${index + 1}`);
	const fieldIds = new Set(fields.map((f) => f.id));
	const base = {
		id,
		name,
		filter: parseFilter(raw.filter, fieldIds),
		sorts: parseSorts(raw.sorts, fieldIds),
		hiddenFieldIds: asArray(raw.hiddenFieldIds)
		.map((v) => asString(v))
		.filter((v) => fieldIds.has(v)),
	};

	if (raw.type === 'kanban') {
		const groupByFieldId = asString(raw.groupByFieldId);
		const groupField = fields.find((f) => f.id === groupByFieldId);
		/*
		 * A board needs a column to group by, but any column will do: a choice gives
		 * the classic board, while a date or a number gives one column per value.
		 * Only a column that is gone sends the view back to the table.
		 */
		if (!groupField) {
			return {...base, type: 'grid', columnWidths: {}, rowHeights: {}};
		}
		const kanban: KanbanView = {
			...base,
			type: 'kanban',
			groupByFieldId,
			cardFieldIds: asArray(raw.cardFieldIds)
				.map((v) => asString(v))
				.filter((v) => fieldIds.has(v)),
		};
		// Clamped on the way in, so a hand-edited file cannot ask for a board that
		// would never finish drawing.
		const limit = raw.columnLimit;
		if (typeof limit === 'number' && Number.isFinite(limit) && limit >= 1) {
			kanban.columnLimit = Math.min(Math.floor(limit), 500);
		}
		if (raw.showEmptyColumns === true) {
			kanban.showEmptyColumns = true;
		}
		// Only a column that is still here may title a card; otherwise the table's
		// primary column stands in.
		const titleId = asString(raw.titleFieldId);
		if (titleId !== '' && fieldIds.has(titleId)) {
			kanban.titleFieldId = titleId;
		}
		return kanban;
	}
	const colorRules = parseColorRules(raw.colorRules, fieldIds);
	return {
		...base,
		type: 'grid',
		columnWidths: parseSizes(raw.columnWidths, fieldIds),
		rowHeight: parseRowHeight(raw.rowHeight),
		rowHeights: parseSizes(raw.rowHeights, recordIds),
		...(raw.wrap === true ? {wrap: true} : {}),
		...(colorRules.length > 0 ? {colorRules} : {}),
	};
}

/**
 * A view's base row height, kept only if it is a size this table can draw.
 */
function parseRowHeight(raw: unknown): number | undefined {
	if (typeof raw !== 'number' || !Number.isFinite(raw)) {
		return undefined;
	}
	return clampRowHeight(raw);
}

/**
 * Reads a map of id to pixel size.
 */
function parseSizes(raw: unknown, knownIds: ReadonlySet<string>): Record<string, number> {
	const sizes: Record<string, number> = {};
	if (!isRecordObject(raw)) {
		return sizes;
	}
	for (const [id, value] of Object.entries(raw)) {
		if (!knownIds.has(id)) {
			continue;
		}
		if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
			sizes[id] = value;
		}
	}
	return sizes;
}

/** Default names for a freshly created board. */
export interface SeedLabels {
	untitledBoard: string;
	titleField: string;
	statusField: string;
	todoOption: string;
	inProgressOption: string;
	doneOption: string;
	gridView: string;
	kanbanView: string;
}

/** English seeds, used when no locale is supplied (and by tests). */
export const DEFAULT_SEED: SeedLabels = {
	untitledBoard: 'Untitled board',
	titleField: 'Title',
	statusField: 'Status',
	todoOption: 'To do',
	inProgressOption: 'In progress',
	doneOption: 'Done',
	gridView: 'Table',
	kanbanView: 'Board',
};

/**
 * A brand-new, valid document. Used for a new file and as the fallback when a
 * file cannot be parsed at all.
 */
export function createEmptyDoc(
	name = DEFAULT_SEED.untitledBoard,
	seed: SeedLabels = DEFAULT_SEED,
): LayerDoc {
	const titleId = generateId('f');
	const statusId = generateId('f');
	const statusOptions: SelectOption[] = [
		{id: generateId('o'), name: seed.todoOption, color: 'default'},
		{id: generateId('o'), name: seed.inProgressOption, color: 'orange'},
		{id: generateId('o'), name: seed.doneOption, color: 'green'},
	];
	const fields: Field[] = [
		{id: titleId, name: seed.titleField, type: 'text', primary: true},
		{id: statusId, name: seed.statusField, type: 'select', options: statusOptions},
	];

	return {
		version: LAYER_FORMAT_VERSION,
		name,
		fields,
		records: [],
		views: [
			{
				id: generateId('v'),
				name: seed.gridView,
				type: 'grid',
				filter: {conjunction: 'and', conditions: []},
				sorts: [],
				hiddenFieldIds: [],
				columnWidths: {},
				rowHeights: {},
				// A new table wraps as it is made, so its first long value already
				// shows in full rather than being cut off at the cell's edge.
				wrap: true,
			},
		],
	};
}

/**
 * Turns raw file text into a valid `LayerDoc`, never throwing.
 */
export function parseLayerDoc(text: string): ParseResult {
	const warnings: string[] = [];

	let parsed: unknown;
	try {
		parsed = JSON.parse(text) as unknown;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		warnings.push(`File is not valid JSON: ${message}`);
		return {doc: createEmptyDoc(), warnings};
	}

	if (!isRecordObject(parsed)) {
		warnings.push('File content is not an object; an empty board was used.');
		return {doc: createEmptyDoc(), warnings};
	}

	const migrated = migrate(parsed, warnings);

	const seenFieldIds = new Set<string>();
	const fields: Field[] = [];
	for (const [index, raw] of asArray(migrated.fields).entries()) {
		const field = parseField(raw, index, seenFieldIds, warnings);
		if (field) {
			fields.push(field);
		} else {
			warnings.push(`Field ${index + 1} could not be read and was skipped.`);
		}
	}

	// Exactly one primary field is required.
	const primaries = fields.filter((f) => f.primary);
	if (primaries.length === 0 && fields.length > 0) {
		const [first] = fields;
		if (first) {
			first.primary = true;
			warnings.push('No primary field was set; the first field was used.');
		}
	} else if (primaries.length > 1) {
		for (const extra of primaries.slice(1)) {
			delete extra.primary;
		}
		warnings.push('Several primary fields were set; the first was kept.');
	}

	const records: LayerRecord[] = [];
	for (const [index, raw] of asArray(migrated.records).entries()) {
		const record = parseRecord(raw, fields, warnings);
		if (record) {
			records.push(record);
		} else {
			warnings.push(`Record ${index + 1} could not be read and was skipped.`);
		}
	}

	const views: View[] = [];
	const recordIds = new Set(records.map((r) => r.id));
	for (const [index, raw] of asArray(migrated.views).entries()) {
		const view = parseView(raw, index, fields, recordIds, warnings);
		if (view) {
			views.push(view);
		} else {
			warnings.push(`View ${index + 1} could not be read and was skipped.`);
		}
	}
	if (views.length === 0) {
		views.push(...createEmptyDoc().views);
		warnings.push('No usable view was left; default views were added.');
	}

	return {
		doc: {
			version: LAYER_FORMAT_VERSION,
			name: asString(migrated.name, DEFAULT_SEED.untitledBoard),
			fields,
			records,
			views,
		},
		warnings,
	};
}

/**
 * Header written at the top of every `.layer` file.
 */
const FILE_HEADER = {
	_format: 'obsidian-layer-base',
	_note: [
		'Self-contained board. Safe to edit as JSON; the plugin tolerates and repairs minor issues.',
		'cells and select values are keyed by id, not by display name, so renaming never orphans data.',
		'records[].created is an ISO 8601 string.',
	],
} as const;

/** Serializes back to the on-disk shape. Pretty-printed so the file stays hand-editable. */
export function serializeLayerDoc(doc: LayerDoc): string {	return `${JSON.stringify({...FILE_HEADER, ...doc}, null, '\t')}\n`;
}