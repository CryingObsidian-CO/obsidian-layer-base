import {
	type CellValue,
	type Field,
	type Filter,
	type FilterCondition,
	type FilterOperator,
	type GridView,
	LAYER_FORMAT_VERSION,
	type LayerDoc,
	type LayerRecord,
	type SelectOption,
	type Sort,
	type View,
} from '../types';
import {generateId} from '../utils/id';
import {FIELD_TYPES, isEmptyCell} from '../model/fields';
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
	if (type === 'select') {
		field.options = parseOptions(raw.options, seen, warnings);
	}
	return field;
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
		const value = normalizeCellValue(cellsSource[field.id]);
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
		// A board is meaningless without a select field to group by.
		if (!groupField || groupField.type !== 'select') {
			return {...base, type: 'grid', columnWidths: {}, rowHeights: {}};
		}
		return {
			...base,
			type: 'kanban',
			groupByFieldId,
			cardFieldIds: asArray(raw.cardFieldIds)
			.map((v) => asString(v))
			.filter((v) => fieldIds.has(v)),
		};
	}

	return {
		...base,
		type: 'grid',
		columnWidths: parseSizes(raw.columnWidths, fieldIds),
		rowHeights: parseSizes(raw.rowHeights, recordIds),
	};
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
			},
			{
				id: generateId('v'),
				name: seed.kanbanView,
				type: 'kanban',
				groupByFieldId: statusId,
				cardFieldIds: [titleId],
				filter: {conjunction: 'and', conditions: []},
				sorts: [],
				hiddenFieldIds: [],
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
