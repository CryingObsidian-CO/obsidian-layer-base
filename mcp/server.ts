/*
 * A Model Context Protocol server for .layer tables.
 *
 * It speaks JSON-RPC over stdio and edits the files directly, so an assistant works
 * through structured calls — add a record, set a cell — instead of writing JSON by
 * hand. The same parse and serialize the plugin uses keeps a file valid whatever a
 * caller asks for.
 *
 * The vault is named by `LAYER_VAULT` (or the first argument). Only files inside it
 * are touched.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseLayerDoc, serializeLayerDoc } from '../src/io/schema';
import { FIELD_TYPES, formatCell, isDerived } from '../src/model/fields';
import { numberTexts } from '../src/model/numbering';
import {
	addField,
	findRecord,
	removeField,
	removeRecords,
	setCellFromText,
	setCellValue,
} from '../src/model/records';
import { addBoardView, removeView, renameView } from '../src/model/views';
import { LAYER_FORMAT_VERSION } from '../src/types';
import type {
	CellValue,
	Field,
	FieldType,
	Filter,
	FilterCondition,
	FilterOperator,
	GridView,
	LayerDoc,
	LayerRecord,
	RollupAggregate,
	Sort,
	View,
} from '../src/types';

/** Every operator a condition may name, so a typo is refused rather than stored. */
const FILTER_OPERATORS: readonly FilterOperator[] = [
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
];

/** How a rollup may reduce the values it gathered. */
const ROLLUP_AGGREGATES: readonly RollupAggregate[] = [
	'sum',
	'average',
	'min',
	'max',
	'count',
	'countAll',
];

const VAULT = resolve(process.env.LAYER_VAULT ?? process.argv[2] ?? '');

/** Said once, so every tool explains where a path is measured from. */
const PATH_HINT =
	'Path of the .layer file, relative to the vault root. Discover them with list_tables.';

interface Request {
	jsonrpc: '2.0';
	id?: number | string | null;
	method: string;
	params?: Record<string, unknown>;
}

/** A file path inside the vault, refused when it would point outside it. */
function vaultFile(path: unknown): string {
	if (typeof path !== 'string' || path.trim() === '') {
		throw new Error('A table path is required');
	}
	const full = resolve(VAULT, path);
	const rel = relative(VAULT, full);
	if (rel.startsWith('..') || isAbsolute(rel)) {
		throw new Error(`Outside the vault: ${path}`);
	}
	return full;
}

function loadTable(path: unknown): { doc: LayerDoc; file: string } {
	const file = vaultFile(path);
	let text: string;
	try {
		text = readFileSync(file, 'utf8');
	} catch {
		// Said in the terms a caller can act on: a wrong path is the usual mistake,
		// and the answer is one call away.
		throw new Error(
			`No table at "${String(path)}". Paths are relative to the vault root (${VAULT}); call list_tables to see the ones that exist.`,
		);
	}
	const { doc, warnings } = parseLayerDoc(text);
	if (warnings.length > 0) {
		console.error(`[layer-mcp] Repaired ${warnings.length} issue(s) in ${file}`);
	}
	return { doc, file };
}

function saveTable(file: string, doc: LayerDoc): void {
	writeFileSync(file, serializeLayerDoc(doc), 'utf8');
}

function fieldOf(doc: LayerDoc, nameOrId: unknown): Field {
	const wanted = typeof nameOrId === 'string' ? nameOrId.trim() : '';
	if (wanted === '') {
		throw new Error('A field name is required');
	}
	const field = doc.fields.find((one) => one.id === wanted || one.name === wanted);
	if (!field) {
		throw new Error(`No such field: ${wanted}`);
	}
	return field;
}

/** The option names a value reads as, so a caller never sees an internal id. */
function shownValue(field: Field, value: CellValue): CellValue {
	if (field.type === 'select') {
		return field.options?.find((option) => option.id === value)?.name ?? '';
	}
	if (field.type === 'multiSelect') {
		const ids = Array.isArray(value) ? value : [];
		return (field.options ?? [])
			.filter((option) => ids.includes(option.id))
			.map((option) => option.name);
	}
	return value;
}

/** A view by name or id. */
function viewOf(doc: LayerDoc, nameOrId: unknown): View {
	const wanted = typeof nameOrId === 'string' ? nameOrId.trim() : '';
	if (wanted === '') {
		throw new Error('A view name is required');
	}
	const view = doc.views.find((one) => one.id === wanted || one.name === wanted);
	if (!view) {
		throw new Error(`No such view: ${wanted}`);
	}
	return view;
}

/** A filter a caller asked for, with column names resolved to ids. */
function filterOf(doc: LayerDoc, raw: unknown): Filter {
	const input = (raw ?? {}) as { conjunction?: unknown; conditions?: unknown };
	const conditions: FilterCondition[] = [];
	for (const entry of Array.isArray(input.conditions) ? input.conditions : []) {
		const item = (entry ?? {}) as Record<string, unknown>;
		const field = fieldOf(doc, item.field);
		const operator = item.operator as FilterOperator;
		if (!FILTER_OPERATORS.includes(operator)) {
			throw new Error(
				`Unknown operator: ${String(item.operator)}. Use one of ${FILTER_OPERATORS.join(', ')}`,
			);
		}
		const value = item.value;
		conditions.push({
			fieldId: field.id,
			operator,
			...(value === undefined || value === null
				? {}
				: { value: value as string | number | boolean }),
		});
	}
	return {
		conjunction: input.conjunction === 'or' ? 'or' : 'and',
		conditions,
	};
}

/** Sort rules a caller asked for, with column names resolved to ids. */
function sortsOf(doc: LayerDoc, raw: unknown): Sort[] {
	const sorts: Sort[] = [];
	for (const entry of Array.isArray(raw) ? raw : []) {
		const item = (entry ?? {}) as Record<string, unknown>;
		sorts.push({
			fieldId: fieldOf(doc, item.field).id,
			order: item.order === 'desc' ? 'desc' : 'asc',
		});
	}
	return sorts;
}

/** Column names resolved to ids, in the order given. */
function fieldIdsOf(doc: LayerDoc, raw: unknown): string[] {
	const ids: string[] = [];
	for (const entry of Array.isArray(raw) ? raw : []) {
		ids.push(fieldOf(doc, entry).id);
	}
	return ids;
}

/** What a stored view says, with ids read back as names where a caller needs them. */
function shownView(doc: LayerDoc, view: View): Record<string, unknown> {
	const nameOf = (id: string): string =>
		doc.fields.find((field) => field.id === id)?.name ?? id;
	return {
		id: view.id,
		name: view.name,
		type: view.type,
		filter: {
			conjunction: view.filter.conjunction,
			conditions: view.filter.conditions.map((condition) => ({
				field: nameOf(condition.fieldId),
				operator: condition.operator,
				...(condition.value === undefined ? {} : { value: condition.value }),
			})),
		},
		sorts: view.sorts.map((sort) => ({
			field: nameOf(sort.fieldId),
			order: sort.order,
		})),
		hiddenFields: view.hiddenFieldIds.map(nameOf),
		...(view.type === 'kanban'
			? {
					groupByField: nameOf(view.groupByFieldId),
					titleField: view.titleFieldId ? nameOf(view.titleFieldId) : null,
					cardFields: view.cardFieldIds.map(nameOf),
					columnLimit: view.columnLimit ?? null,
					showEmptyColumns: view.showEmptyColumns === true,
				}
			: {}),
	};
}

/**
 * What a column is wired to. A caller reading a table this way can see how an existing
 * column of the same kind was built, instead of inventing one that half works.
 */
function fieldConfig(
	doc: LayerDoc,
	field: Field,
	others: Map<string, LayerDoc>,
): Record<string, unknown> {
	const tableFor = (path?: string): LayerDoc | null => {
		if (!path) {
			return doc;
		}
		const cached = others.get(path);
		if (cached) {
			return cached;
		}
		try {
			const loaded = loadTable(path).doc;
			others.set(path, loaded);
			return loaded;
		} catch {
			return null;
		}
	};
	const nameIn = (table: LayerDoc | null, id?: string): string | null => {
		if (!table || !id) {
			return null;
		}
		return table.fields.find((one) => one.id === id)?.name ?? null;
	};

	switch (field.type) {
		case 'relation': {
			const other = tableFor(field.linkPath);
			return {
				targetTable: field.linkPath ?? '(this table)',
				shows: nameIn(other, field.linkFieldId),
			};
		}
		case 'relationBack': {
			const other = tableFor(field.backPath);
			return {
				fromTable: field.backPath ?? '(this table)',
				viaRelation: nameIn(other, field.backFieldId),
				titledBy: nameIn(other, field.backTitleFieldId),
			};
		}
		case 'formula':
			return { formula: field.formula ?? null };
		case 'rollup': {
			const source = doc.fields.find((one) => one.id === field.rollupSourceFieldId);
			const other = tableFor(source?.linkPath);
			return {
				gathersThrough: source?.name ?? null,
				reads: nameIn(other, field.rollupFieldId),
				aggregate: field.rollupAggregate ?? null,
			};
		}
		case 'lookup': {
			const source = doc.fields.find((one) => one.id === field.lookupSourceFieldId);
			const other = tableFor(source?.linkPath);
			return {
				readsThrough: source?.name ?? null,
				shows: nameIn(other, field.lookupFieldId),
			};
		}
		case 'noteProp':
			return {
				noteColumn: nameIn(doc, field.noteFieldId),
				key: field.frontmatterKey ?? null,
			};
		case 'autoNumber':
			return {
				digits: field.numberLength ?? 1,
				numberedPer: nameIn(doc, field.numberGroupFieldId),
			};
		default:
			return {};
	}
}

/**
 * A relation cell, from row ids or from the text the column shows.
 *
 * The grid picks rows from a list, so its own text parser refuses relation values
 * outright. A caller has no list to pick from, so it may name a row either way; anything
 * that matches neither is reported back rather than dropped.
 */
function relationCell(
	doc: LayerDoc,
	field: Field,
	raw: unknown,
): { ids: string[]; unknown: string[] } {
	const target = field.linkPath ? loadTable(field.linkPath).doc : doc;
	const items = Array.isArray(raw)
		? raw
		: asText(raw)
				.split(',')
				.map((one) => one.trim())
				.filter((one) => one !== '');
	const shown =
		target.fields.find((one) => one.id === field.linkFieldId) ??
		target.fields.find((one) => one.primary) ??
		target.fields[0];

	const ids: string[] = [];
	const unknown: string[] = [];
	for (const item of items) {
		const wanted = asText(item).trim();
		if (wanted === '') {
			continue;
		}
		const byId = target.records.find((one) => one.id === wanted);
		if (byId) {
			ids.push(byId.id);
			continue;
		}
		const byText = shown
			? target.records.find(
					(one) => formatCell(shown, one.cells[shown.id] ?? '') === wanted,
				)
			: undefined;
		if (byText) {
			ids.push(byText.id);
		} else {
			unknown.push(wanted);
		}
	}
	return { ids, unknown };
}

/**
 * One value into one cell. A relation is resolved separately because the column's own
 * text parser refuses it: in the grid a row is picked from a list, never typed.
 */
function writeCell(
	doc: LayerDoc,
	recordId: string,
	field: Field,
	raw: unknown,
): { ok: boolean; unknown: string[] } {
	if (field.type === 'relation') {
		const { ids, unknown } = relationCell(doc, field, raw);
		if (unknown.length > 0) {
			return { ok: false, unknown };
		}
		return { ok: setCellValue(doc, recordId, field, ids), unknown: [] };
	}
	return { ok: setCellFromText(doc, recordId, field, asText(raw)), unknown: [] };
}

/**
 * Why a value cannot be stored in this column, and the sentence the caller owes the
 * reader about it. A write that is refused without saying why teaches a reader to
 * distrust the table, so every one of these travels with something to pass on.
 */
function unwritable(field: Field): { reason: string; tellUser: string } {
	switch (field.type) {
		case 'noteProp':
			return {
				reason: "a note property is stored in the note's frontmatter, not in this table",
				tellUser:
					'That column cannot be filled from here: its value lives in the note frontmatter. Edit it in the table in Obsidian, or edit the note itself.',
			};
		case 'autoNumber':
			return {
				reason: 'a numbering column counts each row within its group',
				tellUser:
					'A numbering column shows a position in the table, so there is nothing to write into it.',
			};
		case 'relationBack':
			return {
				reason: 'a backlink column lists the rows of another table that point here',
				tellUser:
					'A backlink column is computed from the other table, so there is nothing to type into it.',
			};
		case 'rollup':
			return {
				reason: 'a rollup column totals rows reached through a relation column',
				tellUser:
					'A rollup value is computed from the related rows and cannot be typed in.',
			};
		case 'lookup':
			return {
				reason: 'a lookup column shows a column of the rows reached through a relation',
				tellUser:
					'A lookup value is read from the related rows and cannot be typed in.',
			};
		default:
			return {
				reason: `a ${field.type} column computes its own value`,
				tellUser: 'A computed value comes from other columns and cannot be typed in.',
			};
	}
}

/**
 * A record with its cells keyed by column name, which is what a caller reads.
 *
 * `numbering` carries what the numbering columns read. Those cells hold nothing,
 * but their value is a position in the table, which this side can count as well
 * as the grid can — so it is reported rather than left out of the answer.
 */
function shownRecord(
	doc: LayerDoc,
	record: LayerRecord,
	numbering?: ReadonlyMap<string, ReadonlyMap<string, string>>,
): Record<string, unknown> {
	const cells: Record<string, CellValue> = {};
	for (const field of doc.fields) {
		if (field.type === 'autoNumber') {
			const text = numbering?.get(field.id)?.get(record.id);
			if (text !== undefined) {
				cells[field.name] = text;
			}
			continue;
		}
		// A derived column has nothing stored; reporting a value would invent one.
		if (isDerived(field.type)) {
			continue;
		}
		const value = record.cells[field.id];
		if (value !== undefined) {
			cells[field.name] = shownValue(field, value);
		}
	}
	return { id: record.id, cells };
}

/** The number every row shows, per numbering column. */
function numberingOf(doc: LayerDoc): Map<string, Map<string, string>> {
	const all = new Map<string, Map<string, string>>();
	for (const field of doc.fields) {
		if (field.type === 'autoNumber') {
			all.set(field.id, numberTexts(doc, field));
		}
	}
	return all;
}

function newId(prefix: string, taken: readonly string[]): string {
	for (;;) {
		const id = `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
		if (!taken.includes(id)) {
			return id;
		}
	}
}

/**
 * A caller's value as the text a column parses.
 *
 * Anything that is not a scalar or a list of scalars reads as nothing rather than as
 * `[object Object]`, which a column would then refuse with a confusing message.
 */
function asText(value: unknown): string {
	if (typeof value === 'string') {
		return value;
	}
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}
	if (Array.isArray(value)) {
		return value
			.map((one) => asText(one))
			.filter((one) => one !== '')
			.join(', ');
	}
	return '';
}

function tableFiles(): string[] {
	const found: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			// Dot folders hold application state, not the reader's tables.
			if (entry.name.startsWith('.') || entry.name === 'node_modules') {
				continue;
			}
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (entry.name.endsWith('.layer')) {
				found.push(relative(VAULT, full).split('\\').join('/'));
			}
		}
	};
	if (statSync(VAULT).isDirectory()) {
		walk(VAULT);
	}
	return found.sort();
}

const tools = [
	{
		name: 'list_tables',
		description:
			'List every .layer table in the vault, with its column and row counts. The answer names the vault root, and every path it returns is relative to that root — pass exactly that path to the other tools.',
		inputSchema: { type: 'object', properties: {} },
	},
	{
		name: 'create_table',
		description:
			'Create a new, empty .layer table at a path inside the vault. It starts with no columns and one table view, so add columns with add_field before adding rows. A file already at that path is never overwritten — the call fails instead.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: PATH_HINT },
				name: {
					type: 'string',
					description: 'Display name for the table. Defaults to the file name.',
				},
			},
			required: ['path'],
		},
	},
	{
		name: 'read_table',
		description:
			'Read a table: its columns, its views, and its rows. Cells are keyed by column name and select values read as option names, so what comes back can be sent straight to update_cells or add_records. Every view is reported with its own filter, sorts and hidden columns — read them before changing a view, because a view is named, not "the one on screen".',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: PATH_HINT },
				offset: { type: 'number', description: 'First row to return (default 0)' },
				limit: { type: 'number', description: 'How many rows (default 100)' },
			},
			required: ['path'],
		},
	},
	{
		name: 'add_records',
		description:
			'Append rows. Each row is an object of column name to value. Values are text as a person would type them: a number is "42", a checkbox is "true" or "false", a date is "2026-01-31", a date and time is "2026-01-31 09:30", a select is the option name, a multi-select is "Red, Blue" or an array of names, and a note column is a vault path like "Folder/Note". A computed column (formula, rollup, lookup, backlinks, note property, numbering) is skipped. A value the column cannot hold comes back in `refused` instead of being written.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: PATH_HINT },
				records: {
					type: 'array',
					items: { type: 'object' },
					description: 'Rows to append, each keyed by column name',
				},
			},
			required: ['path', 'records'],
		},
	},
	{
		name: 'update_cells',
		description:
			'Set individual cells. A record id comes from read_table; a column may be named or given by id. Values follow the same rules as add_records, and a value the column cannot hold is reported in `refused` rather than written. A computed column cannot be written.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: PATH_HINT },
				updates: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							recordId: { type: 'string', description: 'A row id from read_table' },
							field: { type: 'string', description: 'Column name or id' },
							value: { type: 'string' },
						},
						required: ['recordId', 'field', 'value'],
					},
				},
			},
			required: ['path', 'updates'],
		},
	},
	{
		name: 'delete_records',
		description: 'Remove rows by id.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: PATH_HINT },
				recordIds: { type: 'array', items: { type: 'string' } },
			},
			required: ['path', 'recordIds'],
		},
	},
	{
		name: 'add_field',
		description: `Add a column. Types: ${FIELD_TYPES.join(', ')}.

Choosing the type is the part that goes wrong, so read this before deciding:

- When a cell holds a reference to *another row* — a dependency, an owner, a parent, a related item — the type is \`relation\`. That holds even when the rows live in the same table, and even when the text looks like a plain label. A value that is itself a row, with its own columns, is a row reference.
- \`select\` and \`multiSelect\` are for a fixed list of labels that exist only inside this column, typed or picked by hand. If the choices are rows of a table that also has a name, an id and other columns, it is \`relation\`, not \`multiSelect\`.
- \`select\` holds one label; \`multiSelect\` holds several.
- \`note\` holds a vault path to a note; \`noteProp\` reads or writes one frontmatter key of the note a \`note\` column points at.
- \`formula\` computes from other columns; \`rollup\` totals a related table through a relation column; \`relationBack\` lists the rows that point back here; \`lookup\` shows one column of those rows as it reads over there, without totalling anything.

Every type that computes from something else needs that something named, and the call fails rather than storing a column that cannot work: \`relation\` needs \`linkField\` (plus \`targetTable\` when the rows are in another file), \`formula\` needs \`formula\`, \`rollup\` needs \`rollupSource\`, \`rollupField\` and \`rollupAggregate\`, \`lookup\` needs \`lookupSource\` and \`lookupField\`, \`noteProp\` needs \`noteField\`.

**If the type is not obvious from what the reader said, do not guess.** Name two or three candidates, say in one line what each would store for this data, and ask which one they mean. A wrong type silently produces a column that looks right and behaves wrong, which costs far more than one question.

A backlink column (relationBack) is the one type this server cannot create: it needs the relation pointing back at it, which the app sets up. Say so rather than building something similar.

Two limits you have to pass on rather than work around:

- **Dates have no format setting in this plugin.** A date always reads as YYYY-MM-DD and a date-time as YYYY-MM-DD HH:mm. If the reader asks for another format, tell them it is not available; do not silently produce something else.
- **A numbering column is a position, not a stored value.** Each row is counted within its group, in the order the rows sit in the file, so inserting, deleting or regrouping rows renumbers the ones after them. Do not describe it as a permanent id: tell the reader to build a stable id with a formula if they need one.
- **A \`noteProp\` column's values cannot be written from here**, and cannot be read either: they live in the frontmatter of the note a \`note\` column points at, and reading them needs the app. Create the column if it helps, but tell the reader that filling it in happens in the app.`,
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: PATH_HINT },
				name: { type: 'string' },
				type: { type: 'string', enum: [...FIELD_TYPES] },
				options: {
					type: 'array',
					items: { type: 'string' },
					description: 'Option names, for select and multiSelect',
				},
				targetTable: {
					type: 'string',
					description:
						'relation only: the .layer file whose rows a cell picks from. Omit when the rows are in this same table.',
				},
				linkField: {
					type: 'string',
					description:
						'relation only: the column of the target table whose values are shown, usually its name column.',
				},
				formula: {
					type: 'string',
					description:
						'formula only: the expression, naming other columns as {their name}, such as {Score} * 2.',
				},
				rollupSource: {
					type: 'string',
					description: 'rollup only: the relation or backlink column to gather rows through.',
				},
				rollupField: {
					type: 'string',
					description: 'rollup only: the column of the other table to read.',
				},
				rollupAggregate: {
					type: 'string',
					enum: ['sum', 'average', 'min', 'max', 'count', 'countAll'],
					description: 'rollup only: how the gathered values become one number.',
				},
				lookupSource: {
					type: 'string',
					description:
						'lookup only: the relation column to read rows through.',
				},
				lookupField: {
					type: 'string',
					description:
						'lookup only: the column of the other table to show, one value per linked row.',
				},
				noteField: {
					type: 'string',
					description: 'noteProp only: the note column whose file is read.',
				},
				frontmatterKey: {
					type: 'string',
					description:
						'noteProp only: the frontmatter key to read and write. Defaults to the column name.',
				},
				numberLength: {
					type: 'number',
					description:
						'autoNumber only: how many digits to pad the count to.',
				},
				numberGroup: {
					type: 'string',
					description:
						'autoNumber only: the column whose values are counted separately, each starting again at 1. Omit to count the whole table as one sequence.',
				},
				numberFormat: {
					type: 'string',
					enum: ['plain', 'percent'],
					description: 'number only: how the value is shown.',
				},
				decimals: {
					type: 'number',
					description: 'number only: decimal places, 0 to 10.',
				},
				min: {
					type: 'number',
					description: 'number only: the smallest value a cell may hold.',
				},
				max: {
					type: 'number',
					description: 'number only: the largest value a cell may hold.',
				},
			},
			required: ['path', 'name', 'type'],
		},
	},
	{
		name: 'delete_field',
		description: 'Remove a column and the values in it.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: PATH_HINT },
				field: { type: 'string', description: 'Column name or id' },
			},
			required: ['path', 'field'],
		},
	},
	{
		name: 'add_view',
		description: 'Add a board view, grouping by a column or by the default one.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: PATH_HINT },
				name: { type: 'string' },
				groupByField: { type: 'string', description: 'Column name or id' },
			},
			required: ['path', 'name'],
		},
	},
	{
		name: 'update_view',
		description:
			'Change one stored view: its name, its filter, its sorts, its hidden columns, and — on a board — the column it groups by, the columns a card shows, and its column limit. Only the fields passed are changed; the rest keep their value.\n\nThis edits the view you name, which is not necessarily the view on screen: the file does not record which view is open, and this server cannot see Obsidian. Read the views with read_table and name the one you mean. Obsidian redraws it if it is open.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: PATH_HINT },
				view: { type: 'string', description: 'View name or id' },
				name: { type: 'string', description: 'New name for the view' },
				filter: {
					type: 'object',
					description:
						'Rows the view keeps. Pass an empty conditions list to clear it.',
					properties: {
						conjunction: { type: 'string', enum: ['and', 'or'] },
						conditions: {
							type: 'array',
							items: {
								type: 'object',
								properties: {
									field: { type: 'string', description: 'Column name or id' },
									operator: {
										type: 'string',
										enum: [...FILTER_OPERATORS],
									},
									value: {
										type: 'string',
										description:
											'What to compare with, as text. Not needed by isEmpty, isNotEmpty, checked or unchecked.',
									},
								},
								required: ['field', 'operator'],
							},
						},
					},
				},
				sorts: {
					type: 'array',
					description: 'Order of the rows. Pass an empty list to clear it.',
					items: {
						type: 'object',
						properties: {
							field: { type: 'string', description: 'Column name or id' },
							order: { type: 'string', enum: ['asc', 'desc'] },
						},
						required: ['field', 'order'],
					},
				},
				hiddenFields: {
					type: 'array',
					items: { type: 'string' },
					description: 'Columns this view hides, by name. Pass [] to show all.',
				},
				groupByField: {
					type: 'string',
					description: 'Board only: the column its columns are made from.',
				},
				titleField: {
					type: 'string',
					description: 'Board only: the column a card is titled by.',
				},
				cardFields: {
					type: 'array',
					items: { type: 'string' },
					description: 'Board only: the columns shown under a card title, in order.',
				},
				columnLimit: {
					type: 'number',
					description: 'Board only: how many columns to draw before summarising the rest.',
				},
				showEmptyColumns: {
					type: 'boolean',
					description: 'Board only: also draw columns no row uses yet.',
				},
			},
			required: ['path', 'view'],
		},
	},
	{
		name: 'delete_view',
		description: 'Remove a board view. The table view cannot be removed.',
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: PATH_HINT },
				view: { type: 'string', description: 'View name or id' },
			},
			required: ['path', 'view'],
		},
	},
] as const;

function runTool(name: string, args: Record<string, unknown>): unknown {
	switch (name) {
		case 'create_table': {
			const file = vaultFile(args.path);
			if (!file.endsWith('.layer')) {
				throw new Error('A table file has to end with .layer');
			}
			let exists = true;
			try {
				statSync(file);
			} catch {
				exists = false;
			}
			if (exists) {
				throw new Error(
					`Something is already at "${String(args.path)}"; choose another path. Nothing was written.`,
				);
			}
			const given = typeof args.name === 'string' ? args.name.trim() : '';
			const tableName = given === '' ? basename(file, '.layer') : given;
			// Named after the table rather than a fixed word: this process has no interface
			// language, and the app's own default ("表格" or "Table") would be wrong in one
			// of them. The table's name reads correctly either way, and update_view renames it.
			const view: GridView = {
				id: newId('v', []),
				name: tableName,
				type: 'grid',
				columnWidths: {},
				rowHeights: {},
				filter: { conjunction: 'and', conditions: [] },
				sorts: [],
				hiddenFieldIds: [],
			};
			const doc: LayerDoc = {
				version: LAYER_FORMAT_VERSION,
				name: tableName,
				fields: [],
				records: [],
				views: [view],
			};
			mkdirSync(dirname(file), { recursive: true });
			writeFileSync(file, serializeLayerDoc(doc), 'utf8');
			return { path: args.path, name: doc.name, fields: 0, records: 0, views: 1 };
		}

		case 'list_tables': {
			// The vault is named in the answer so every path below reads as what it is.
			return {
				vault: VAULT,
				tables: tableFiles().map((path) => {
					const { doc } = loadTable(path);
					return {
						path,
						name: doc.name,
						fields: doc.fields.length,
						records: doc.records.length,
						views: doc.views.length,
					};
				}),
			};
		}

		case 'read_table': {
			const { doc } = loadTable(args.path);
			// Loaded at most once per table, however many columns point at it.
			const otherTables = new Map<string, LayerDoc>();
			const offset = typeof args.offset === 'number' ? Math.max(0, args.offset) : 0;
			const limit = typeof args.limit === 'number' ? Math.max(0, args.limit) : 100;
			// A relation cell holds row ids, which mean nothing on their own. Every table
			// a relation points at is listed here once, so a caller can read the rows and
			// still know which is which.
			const rowLabels: Record<string, string> = {};
			for (const field of doc.fields) {
				if (field.type !== 'relation') {
					continue;
				}
				const target = field.linkPath
					? (otherTables.get(field.linkPath) ??
						(() => {
							try {
								const loaded = loadTable(field.linkPath).doc;
								otherTables.set(field.linkPath, loaded);
								return loaded;
							} catch {
								return null;
							}
						})())
					: doc;
				if (!target) {
					continue;
				}
				const shown =
					target.fields.find((one) => one.id === field.linkFieldId) ??
					target.fields.find((one) => one.primary) ??
					target.fields[0];
				if (!shown) {
					continue;
				}
				for (const record of target.records) {
					rowLabels[record.id] = formatCell(shown, record.cells[shown.id] ?? '');
				}
			}

			// A numbering column stores nothing, but what it reads is the row's
			// position, which this side can work out too — so it is still reported.
			const numbering = numberingOf(doc);
			return {
				path: args.path,
				name: doc.name,
				fields: doc.fields.map((field) => {
					const config = fieldConfig(doc, field, otherTables);
					return {
						id: field.id,
						name: field.name,
						type: field.type,
						...(field.options
							? { options: field.options.map((option) => option.name) }
							: {}),
						...(Object.keys(config).length > 0 ? { config } : {}),
						...(isDerived(field.type) ? { computed: true } : {}),
					};
				}),
				views: doc.views.map((view) => shownView(doc, view)),
				total: doc.records.length,
				...(Object.keys(rowLabels).length > 0 ? { rowLabels } : {}),
				records: doc.records
					.slice(offset, offset + limit)
					.map((record) => shownRecord(doc, record, numbering)),
			};
		}

		case 'add_records': {
			const { doc, file } = loadTable(args.path);
			const rows = Array.isArray(args.records) ? args.records : [];
			const added: string[] = [];
			const refused: Array<{ field: string; value: unknown }> = [];
			const skipped: Array<{ field: string; reason: string; tellUser: string }> = [];
			for (const row of rows) {
				if (!row || typeof row !== 'object') {
					continue;
				}
				const record: LayerRecord = {
					id: newId(
						'r',
						doc.records.map((one) => one.id),
					),
					created: new Date().toISOString(),
					cells: {},
				};
				doc.records.push(record);
				for (const [column, value] of Object.entries(row as Record<string, unknown>)) {
					const field = doc.fields.find((one) => one.name === column);
					if (!field) {
						continue;
					}
					// A computed column has nothing to store, and saying so is better than
					// dropping the value and letting the caller believe it was written.
					if (isDerived(field.type)) {
						skipped.push({ field: column, ...unwritable(field) });
						continue;
					}
					const text = asText(value);
					const empty = text === '' && !(Array.isArray(value) && value.length > 0);
					if (empty) {
						continue;
					}
					const result = writeCell(doc, record.id, field, value);
					if (!result.ok) {
						refused.push({
							field: column,
							value,
							...(result.unknown.length > 0
								? { unknownRows: result.unknown }
								: {}),
						});
					}
				}
				added.push(record.id);
			}
			saveTable(file, doc);
			return { added, refused, skipped };
		}

		case 'update_cells': {
			const { doc, file } = loadTable(args.path);
			const updates = Array.isArray(args.updates) ? args.updates : [];
			const refused: Array<{
				recordId: string;
				field: string;
				value: unknown;
				unknownRows?: string[];
				reason?: string;
				tellUser?: string;
			}> = [];
			let updated = 0;
			for (const entry of updates) {
				if (!entry || typeof entry !== 'object') {
					continue;
				}
				const item = entry as Record<string, unknown>;
				const recordId = typeof item.recordId === 'string' ? item.recordId : '';
				if (!findRecord(doc, recordId)) {
					throw new Error(`No such record: ${recordId}`);
				}
				const field = fieldOf(doc, item.field);
				if (isDerived(field.type)) {
					refused.push({ recordId, field: field.name, value: item.value, ...unwritable(field) });
					continue;
				}
				const result = writeCell(doc, recordId, field, item.value);
				if (result.ok) {
					updated += 1;
				} else {
					refused.push({
						recordId,
						field: field.name,
						value: item.value,
						...(result.unknown.length > 0 ? { unknownRows: result.unknown } : {}),
					});
				}
			}
			saveTable(file, doc);
			return { updated, refused };
		}

		case 'delete_records': {
			const { doc, file } = loadTable(args.path);
			const ids = Array.isArray(args.recordIds)
				? args.recordIds.filter((id): id is string => typeof id === 'string')
				: [];
			const removed = removeRecords(doc, ids);
			saveTable(file, doc);
			return { removed };
		}

		case 'add_field': {
			const { doc, file } = loadTable(args.path);
			const name = typeof args.name === 'string' ? args.name.trim() : '';
			const type = args.type as FieldType;
			if (name === '') {
				throw new Error('A column name is required');
			}
			if (!FIELD_TYPES.includes(type)) {
				throw new Error(`Unknown column type: ${String(args.type)}`);
			}
			const field: Field = {
				id: newId(
					'f',
					doc.fields.map((one) => one.id),
				),
				name,
				type,
			};
			if (type === 'select' || type === 'multiSelect') {
				const names = Array.isArray(args.options)
					? args.options.filter((one): one is string => typeof one === 'string')
					: [];
				// Collected as they are made: reading `field.options` here would still be
				// empty, and two options could be handed the same id.
				const taken: string[] = [];
				field.options = names.map((optionName) => {
					const id = newId('o', taken);
					taken.push(id);
					return { id, name: optionName, color: 'default' };
				});
			}

			// A column that reads from something else is only usable once that something
			// is named. Refusing beats storing a column that looks right and shows nothing.
			if (type === 'relation') {
				const targetPath = asText(args.targetTable).trim();
				const elsewhere = targetPath !== '' && vaultFile(targetPath) !== file;
				const other = elsewhere ? loadTable(targetPath).doc : doc;
				const shown = asText(args.linkField).trim();
				if (shown === '') {
					throw new Error(
						'A relation column needs `linkField`: the column of the target table whose values it shows. Ask which column names a row — usually the title or name column.',
					);
				}
				field.linkFieldId = fieldOf(other, shown).id;
				if (elsewhere) {
					field.linkPath = targetPath;
				}
			}

			if (type === 'relationBack') {
				throw new Error(
					'A backlink column has to name the relation that points at it, which this server cannot set up. Tell the user plainly that this column type has to be created in the Obsidian app, and that nothing was created here.',
				);
			}

			if (type === 'formula') {
				const expression = asText(args.formula).trim();
				if (expression === '') {
					throw new Error(
						'A formula column needs `formula`, for example {Score} * 2. Ask what it should compute rather than guessing.',
					);
				}
				field.formula = expression;
			}

			if (type === 'rollup') {
				const sourceName = asText(args.rollupSource).trim();
				if (sourceName === '') {
					throw new Error(
						'A rollup gathers rows through a relation column, so it needs `rollupSource`: the name of that column.',
					);
				}
				const source = fieldOf(doc, sourceName);
				if (source.type !== 'relation') {
					throw new Error(
						`A rollup gathers rows through a relation column, and "${source.name}" is ${source.type}.`,
					);
				}
				const readName = asText(args.rollupField).trim();
				if (readName === '') {
					throw new Error(
						'A rollup needs `rollupField`: the column of the other table to read, such as its amount column.',
					);
				}
				const aggregate = args.rollupAggregate as RollupAggregate;
				if (!ROLLUP_AGGREGATES.includes(aggregate)) {
					throw new Error(
						`A rollup needs rollupAggregate, one of: ${ROLLUP_AGGREGATES.join(', ')}.`,
					);
				}
				const other = source.linkPath ? loadTable(source.linkPath).doc : doc;
				field.rollupSourceFieldId = source.id;
				field.rollupFieldId = fieldOf(other, readName).id;
				field.rollupAggregate = aggregate;
			}

			if (type === 'lookup') {
				const sourceName = asText(args.lookupSource).trim();
				if (sourceName === '') {
					throw new Error(
						'A lookup reads rows through a relation column, so it needs `lookupSource`: the name of that column.',
					);
				}
				const source = fieldOf(doc, sourceName);
				if (source.type !== 'relation') {
					throw new Error(
						`A lookup reads rows through a relation column, and "${source.name}" is ${source.type}.`,
					);
				}
				const readName = asText(args.lookupField).trim();
				if (readName === '') {
					throw new Error(
						'A lookup needs `lookupField`: the column of the other table to show, such as its owner column.',
					);
				}
				const other = source.linkPath ? loadTable(source.linkPath).doc : doc;
				field.lookupSourceFieldId = source.id;
				field.lookupFieldId = fieldOf(other, readName).id;
			}

			if (type === 'noteProp') {
				const noteName = asText(args.noteField).trim();
				if (noteName === '') {
					throw new Error(
						'A note property reads one frontmatter key of the note a `note` column points at, so it needs `noteField`: the name of that note column.',
					);
				}
				const noteField = fieldOf(doc, noteName);
				if (noteField.type !== 'note') {
					throw new Error(
						`A note property reads the note a note column points at, and "${noteField.name}" is ${noteField.type}.`,
					);
				}
				field.noteFieldId = noteField.id;
				const key = asText(args.frontmatterKey).trim();
				if (key !== '') {
					field.frontmatterKey = key;
				}
			}

			if (type === 'autoNumber') {
				if (typeof args.numberLength === 'number') {
					field.numberLength = Math.max(1, Math.floor(args.numberLength));
				}
				const groupName = asText(args.numberGroup).trim();
				if (groupName !== '') {
					const groupField = fieldOf(doc, groupName);
					if (isDerived(groupField.type)) {
						throw new Error(
							`A numbering column cannot count within "${groupField.name}": that column is computed, so it stores no value to count by.`,
						);
					}
					field.numberGroupFieldId = groupField.id;
				}
			}

			if (type === 'number') {
				const format = asText(args.numberFormat).trim();
				if (format !== '') {
					if (format !== 'plain' && format !== 'percent') {
						throw new Error(`Unknown number format: ${format}. Use plain or percent.`);
					}
					field.numberFormat = format;
				}
				if (typeof args.decimals === 'number') {
					field.decimals = Math.max(0, Math.min(10, Math.floor(args.decimals)));
				}
				if (typeof args.min === 'number') {
					field.min = args.min;
				}
				if (typeof args.max === 'number') {
					field.max = args.max;
				}
			}

			addField(doc, field);
			saveTable(file, doc);
			// The column exists but cannot be filled from here; the caller owes the reader
			// that sentence now, not after they have typed the first value into it.
			if (field.type === 'noteProp') {
				return {
					id: field.id,
					name: field.name,
					type: field.type,
					tellUser:
						'The column was created, but its values cannot be set from here — they live in the note frontmatter. Fill it in the table in Obsidian.',
				};
			}
			return { id: field.id, name: field.name, type: field.type };
		}

		case 'delete_field': {
			const { doc, file } = loadTable(args.path);
			const field = fieldOf(doc, args.field);
			const removed = removeField(doc, field.id);
			saveTable(file, doc);
			return { removed, name: field.name };
		}

		case 'add_view': {
			const { doc, file } = loadTable(args.path);
			const name = typeof args.name === 'string' ? args.name.trim() : '';
			if (name === '') {
				throw new Error('A view name is required');
			}
			const view = addBoardView(doc, name);
			if (!view) {
				throw new Error('This table has no column a board could group by');
			}
			if (typeof args.groupByField === 'string' && args.groupByField !== '') {
				view.groupByFieldId = fieldOf(doc, args.groupByField).id;
			}
			saveTable(file, doc);
			return { id: view.id, name: view.name, groupByFieldId: view.groupByFieldId };
		}

		case 'update_view': {
			const { doc, file } = loadTable(args.path);
			const view = viewOf(doc, args.view);
			if (typeof args.name === 'string' && args.name.trim() !== '') {
				renameView(doc, view.id, args.name.trim());
			}
			// Shared by every view type: what it shows and in what order.
			if (args.filter !== undefined) {
				view.filter = filterOf(doc, args.filter);
			}
			if (args.sorts !== undefined) {
				view.sorts = sortsOf(doc, args.sorts);
			}
			if (args.hiddenFields !== undefined) {
				view.hiddenFieldIds = fieldIdsOf(doc, args.hiddenFields);
			}
			// Board-only settings, refused on a table rather than quietly ignored.
			const boardOnly =
				args.groupByField !== undefined ||
				args.titleField !== undefined ||
				args.cardFields !== undefined ||
				args.columnLimit !== undefined ||
				args.showEmptyColumns !== undefined;
			if (boardOnly && view.type !== 'kanban') {
				throw new Error('Grouping, card fields and column limits belong to a board view');
			}
			if (view.type === 'kanban') {
				if (typeof args.groupByField === 'string' && args.groupByField !== '') {
					view.groupByFieldId = fieldOf(doc, args.groupByField).id;
				}
				if (typeof args.titleField === 'string' && args.titleField !== '') {
					view.titleFieldId = fieldOf(doc, args.titleField).id;
				}
				if (args.cardFields !== undefined) {
					view.cardFieldIds = fieldIdsOf(doc, args.cardFields);
				}
				if (typeof args.columnLimit === 'number') {
					view.columnLimit = Math.max(1, Math.floor(args.columnLimit));
				}
				if (typeof args.showEmptyColumns === 'boolean') {
					view.showEmptyColumns = args.showEmptyColumns;
				}
			}
			saveTable(file, doc);
			return shownView(doc, view);
		}

		case 'delete_view': {
			const { doc, file } = loadTable(args.path);
			const view = viewOf(doc, args.view);
			const removed = removeView(doc, view.id);
			saveTable(file, doc);
			return { removed, name: view.name };
		}

		default:
			throw new Error(`Unknown tool: ${name}`);
	}
}

function send(message: unknown): void {
	process.stdout.write(`${JSON.stringify(message)}\n`);
}

function answer(id: Request['id'], result: unknown): void {
	send({ jsonrpc: '2.0', id, result });
}

function fail(id: Request['id'], code: number, message: string): void {
	send({ jsonrpc: '2.0', id, error: { code, message } });
}

function handle(request: Request): void {
	const { id, method, params } = request;
	switch (method) {
		case 'initialize':
			answer(id, {
				// Echoed so a client that asks for a newer revision is not refused.
				protocolVersion:
					typeof params?.protocolVersion === 'string'
						? params.protocolVersion
						: '2024-11-05',
				capabilities: { tools: {} },
				// Kept in step with manifest.json by hand; nothing reads it but a client
				// showing which build it is talking to.
				serverInfo: { name: 'layer-base', version: '0.1.0' },
			});
			return;
		case 'notifications/initialized':
			return;
		case 'tools/list':
			answer(id, { tools });
			return;
		case 'tools/call': {
			const name = typeof params?.name === 'string' ? params.name : '';
			const args =
				params?.arguments && typeof params.arguments === 'object'
					? (params.arguments as Record<string, unknown>)
					: {};
			try {
				const result = runTool(name, args);
				answer(id, {
					content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				answer(id, {
					content: [{ type: 'text', text: `Error: ${message}` }],
					isError: true,
				});
			}
			return;
		}
		default:
			if (id !== undefined && id !== null) {
				fail(id, -32601, `Unknown method: ${method}`);
			}
	}
}

if (!process.env.LAYER_VAULT && !process.argv[2]) {
	console.error('[layer-mcp] Set LAYER_VAULT to the vault folder.');
	process.exit(1);
}

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
	buffer += chunk;
	for (;;) {
		const newline = buffer.indexOf('\n');
		if (newline === -1) {
			break;
		}
		const line = buffer.slice(0, newline).trim();
		buffer = buffer.slice(newline + 1);
		if (line === '') {
			continue;
		}
		try {
			handle(JSON.parse(line) as Request);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error(`[layer-mcp] Bad request: ${message}`);
		}
	}
});
