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
import { FIELD_TYPES, isDerived } from '../src/model/fields';
import {
	addField,
	findRecord,
	removeField,
	removeRecords,
	setCellFromText,
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

/** A record with its cells keyed by column name, which is what a caller reads. */
function shownRecord(doc: LayerDoc, record: LayerRecord): Record<string, unknown> {
	const cells: Record<string, CellValue> = {};
	for (const field of doc.fields) {
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
			'Append rows. Each row is an object of column name to value. Values are text as a person would type them: a number is "42", a checkbox is "true" or "false", a date is "2026-01-31", a date and time is "2026-01-31 09:30", a select is the option name, a multi-select is "Red, Blue" or an array of names, and a note column is a vault path like "Folder/Note". A computed column (formula, rollup, backlinks, note property) is skipped. A value the column cannot hold comes back in `refused` instead of being written.',
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
		description: `Add a column. Types: ${FIELD_TYPES.join(', ')}. Select types take an options list of names.`,
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: PATH_HINT },
				name: { type: 'string' },
				type: { type: 'string' },
				options: {
					type: 'array',
					items: { type: 'string' },
					description: 'Option names, for select and multiSelect',
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
			const view: GridView = {
				id: newId('v', []),
				// The one label this server writes; a caller can rename it with update_view.
				name: 'Table',
				type: 'grid',
				columnWidths: {},
				rowHeights: {},
				filter: { conjunction: 'and', conditions: [] },
				sorts: [],
				hiddenFieldIds: [],
			};
			const doc: LayerDoc = {
				version: LAYER_FORMAT_VERSION,
				name: given === '' ? basename(file, '.layer') : given,
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
			const offset = typeof args.offset === 'number' ? Math.max(0, args.offset) : 0;
			const limit = typeof args.limit === 'number' ? Math.max(0, args.limit) : 100;
			return {
				path: args.path,
				name: doc.name,
				fields: doc.fields.map((field) => ({
					id: field.id,
					name: field.name,
					type: field.type,
					...(field.options
						? { options: field.options.map((option) => option.name) }
						: {}),
					...(isDerived(field.type) ? { computed: true } : {}),
				})),
				views: doc.views.map((view) => shownView(doc, view)),
				total: doc.records.length,
				records: doc.records
					.slice(offset, offset + limit)
					.map((record) => shownRecord(doc, record)),
			};
		}

		case 'add_records': {
			const { doc, file } = loadTable(args.path);
			const rows = Array.isArray(args.records) ? args.records : [];
			const added: string[] = [];
			const refused: Array<{ field: string; value: unknown }> = [];
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
					if (!field || isDerived(field.type)) {
						continue;
					}
					const text = asText(value);
					if (text !== '' && !setCellFromText(doc, record.id, field, text)) {
						refused.push({ field: column, value });
					}
				}
				added.push(record.id);
			}
			saveTable(file, doc);
			return { added, refused };
		}

		case 'update_cells': {
			const { doc, file } = loadTable(args.path);
			const updates = Array.isArray(args.updates) ? args.updates : [];
			const refused: Array<{ recordId: string; field: string; value: unknown }> = [];
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
					refused.push({ recordId, field: field.name, value: item.value });
					continue;
				}
				const text = asText(item.value);
				if (setCellFromText(doc, recordId, field, text)) {
					updated += 1;
				} else {
					refused.push({ recordId, field: field.name, value: item.value });
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
			addField(doc, field);
			saveTable(file, doc);
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
