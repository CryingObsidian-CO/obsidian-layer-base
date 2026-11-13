/* MCP server for .layer tables: JSON-RPC over stdio, editing the files directly through
 * the plugin's own parse and serialize. The vault comes from `LAYER_VAULT` (or the first
 * argument); nothing outside it is touched. */
import {
	basename,
	dirname,
	existsSync,
	join,
	mkdirSync,
	proc,
	readdirSync,
	relative,
	resolve,
	statSync,
} from './node-api';
import { parseLayerDoc, serializeLayerDoc } from '../src/io/schema';
import { FutureVersionError } from '../src/io/migrate';
import { createFileText, readFileText, writeFileText } from './table-file';
import { frontmatterValue } from './frontmatter';
import { vaultGuard } from './vault-path';
import { CellReader } from '../src/model/cell-reader';
import { pickTablePath } from '../src/model/table-path';
import { parseFormula, type FormulaNode } from '../src/model/formula/parser';
import {
	FIELD_TYPES,
	canBeRequired,
	emptyValueFor,
	formatCell,
	isDerived,
} from '../src/model/fields';
import { numberTexts } from '../src/model/numbering';
import {
	addField,
	changeFieldType,
	findRecord,
	removeField,
	removeRecords,
	setCellFromText,
	setCellValue,
} from '../src/model/records';
import type { SummaryKind } from '../src/model/summary';
import { capabilityOf } from '../src/model/capabilities';
import {
	OPTION_PALETTE,
	appendOption,
	nextOptionColor,
	normaliseOptionColor,
	removeOption,
	renameOption,
	setOptionColor,
} from '../src/model/select-options';
import { addBoardView, removeView, renameView } from '../src/model/views';
import { LAYER_FORMAT_VERSION } from '../src/types';
import type {
	CellValue,
	ColorRule,
	Field,
	FieldType,
	Filter,
	FilterCondition,
	FilterOperator,
	FormulaResultType,
	GridView,
	LayerDoc,
	LayerRecord,
	RollupAggregate,
	SelectOption,
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

/** What a column footer may report, so a typo is refused rather than stored. */
const SUMMARY_KINDS: readonly SummaryKind[] = [
	'none',
	'filled',
	'empty',
	'unique',
	'sum',
	'average',
	'min',
	'max',
	'earliest',
	'latest',
	'range',
];

/** How a formula's result may be presented, which never changes the value. */
const FORMULA_TYPES: readonly FormulaResultType[] = [
	'number',
	'text',
	'boolean',
];

const VAULT = resolve(proc.env.LAYER_VAULT ?? proc.argv[2] ?? '');

const PATH_HINT =
	'Path of the .layer file, relative to the vault root. Discover them with list_tables.';

const WRITE_REVISION_NOTE =
	' If the file changed on disk after the call read it, nothing is written and the call fails; read the table again.';

interface Request {
	jsonrpc: '2.0';
	id?: number | string | null;
	method: string;
	params?: Record<string, unknown>;
}

/** Refuses a path outside the vault, both lexically and through links. */
const vaultFile = vaultGuard(VAULT);

function loadTable(path: unknown): { doc: LayerDoc; file: string; text: string } {
	const file = vaultFile(path);
	let text: string;
	try {
		text = readFileText(file);
	} catch {
		throw new Error(
			`No table at "${String(path)}". Paths are relative to the vault root (${VAULT}); call list_tables to see the ones that exist.`,
		);
	}
	let parsed: ReturnType<typeof parseLayerDoc>;
	try {
		parsed = parseLayerDoc(text);
	} catch (error) {
		if (error instanceof FutureVersionError) {
			// Refused rather than rewritten: a write would drop whatever the newer format added.
			throw new Error(
				`"${String(path)}" was written by a newer build (format v${error.version}); this server supports up to v${LAYER_FORMAT_VERSION}. It is refused rather than rewritten — update the plugin and this server, then call again.`,
			);
		}
		throw error;
	}
	const { doc, warnings } = parsed;
	if (warnings.length > 0) {
		console.error(`[layer-mcp] Repaired ${warnings.length} issue(s) in ${file}`);
	}
	return { doc, file, text };
}

/** CAS save: writes only if the file still holds the text `loadTable` read. */
function saveTable(file: string, doc: LayerDoc, expectedText: string): void {
	writeFileText(file, serializeLayerDoc(doc), expectedText);
}

/** The file a note path names, with or without its `.md` extension. */
function resolveNoteFile(notePath: string): string | null {
	const candidates = notePath.endsWith('.md')
		? [notePath]
		: [notePath, `${notePath}.md`];
	for (const candidate of candidates) {
		try {
			const file = vaultFile(candidate);
			if (existsSync(file)) {
				return file;
			}
		} catch {
			// A candidate that cannot be read is simply not the note; try the next.
		}
	}
	return null;
}

function isFileInVault(path: string): boolean {
	try {
		return existsSync(vaultFile(path));
	} catch {
		return false;
	}
}

/** Lists the vault only when the stored path is gone; a full walk is the slow answer. */
function tablePathForRead(
	storedPath: string,
	tables?: readonly string[],
): string | null {
	return pickTablePath(
		storedPath,
		tables ?? (isFileInVault(storedPath) ? [] : tableFiles()),
		isFileInVault,
	);
}

/**
 * Resolves a stored link the way the cell reader does, so what is reported matches what the
 * cell shows. `loaded` keeps one request to one read per table.
 */
function tableAt(
	doc: LayerDoc,
	path: string | undefined,
	loaded: Map<string, LayerDoc>,
): LayerDoc | null {
	if (!path) {
		return doc;
	}
	const cached = loaded.get(path);
	if (cached) {
		return cached;
	}
	const resolved = tablePathForRead(path);
	if (!resolved) {
		return null;
	}
	try {
		const other = loadTable(resolved).doc;
		loaded.set(path, other);
		loaded.set(resolved, other);
		return other;
	} catch {
		return null;
	}
}

function nameIn(table: LayerDoc | null, id?: string): string | null {
	if (!table || !id) {
		return null;
	}
	return table.fields.find((one) => one.id === id)?.name ?? null;
}

/** The stored path only when no table answers to it, where naming it explains the failure. */
function linkPathForRead(path: string | undefined): string | undefined {
	return path ? (tablePathForRead(path) ?? path) : undefined;
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

/** Column footers, by column name, keeping only totals that column can report. */
function summariesOf(doc: LayerDoc, raw: unknown): Record<string, SummaryKind> {
	const chosen: Record<string, SummaryKind> = {};
	if (!raw || typeof raw !== 'object') {
		return chosen;
	}
	for (const [name, kind] of Object.entries(raw as Record<string, unknown>)) {
		const field = fieldOf(doc, name);
		const wanted = asText(kind).trim();
		if (wanted === '' || wanted === 'none') {
			continue;
		}
		const offered = capabilityOf(field.type).summaries;
		if (!SUMMARY_KINDS.includes(wanted as SummaryKind) || !offered.includes(wanted as SummaryKind)) {
			throw new Error(
				`"${field.name}" cannot report ${wanted}. It can report: ${offered.join(', ')}.`,
			);
		}
		chosen[field.id] = wanted as SummaryKind;
	}
	return chosen;
}

/** Whole-row tints, in priority order: the first rule a row matches is the one drawn. */
function colorRulesOf(doc: LayerDoc, raw: unknown): ColorRule[] {
	return asList(raw).map((one) => {
		const field = fieldOf(doc, one.field);
		const operator = asText(one.operator) as FilterOperator;
		if (!FILTER_OPERATORS.includes(operator)) {
			throw new Error(
				`Unknown operator: ${asText(one.operator)}. Use one of: ${FILTER_OPERATORS.join(', ')}.`,
			);
		}
		if (!capabilityOf(field.type).filters.includes(operator)) {
			throw new Error(`"${field.name}" cannot be tested with ${operator}.`);
		}
		const color = asText(one.color).trim();
		if (!OPTION_PALETTE.includes(color)) {
			throw new Error(
				`Unknown colour: ${color}. Use one of: ${OPTION_PALETTE.join(', ')}.`,
			);
		}
		return {
			fieldId: field.id,
			operator,
			...(one.value === undefined || one.value === null
				? {}
				: { value: asText(one.value) }),
			color,
		};
	});
}

/** Column widths, by column name: the pixels the reader dragged the edge to. */
function widthsOf(doc: LayerDoc, raw: unknown): Record<string, number> {
	const widths: Record<string, number> = {};
	if (!raw || typeof raw !== 'object') {
		return widths;
	}
	for (const [name, width] of Object.entries(raw as Record<string, unknown>)) {
		const field = fieldOf(doc, name);
		if (typeof width !== 'number' || !Number.isFinite(width)) {
			continue;
		}
		widths[field.id] = Math.max(1, Math.round(width));
	}
	return widths;
}

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

/** How a column is wired, so a caller can build another like it. */
function fieldConfig(
	doc: LayerDoc,
	field: Field,
	others: Map<string, LayerDoc>,
): Record<string, unknown> {
	const tableFor = (path?: string): LayerDoc | null => tableAt(doc, path, others);

	switch (field.type) {
		case 'relation': {
			const other = tableFor(field.linkPath);
			return {
				targetTable: linkPathForRead(field.linkPath) ?? '(this table)',
				shows: nameIn(other, field.linkFieldId),
			};
		}
		case 'relationBack': {
			const other = tableFor(field.backPath);
			return {
				fromTable: linkPathForRead(field.backPath) ?? '(this table)',
				viaRelation: nameIn(other, field.backFieldId),
				titledBy: nameIn(other, field.backTitleFieldId),
			};
		}
		case 'formula':
			return { formula: field.formula ?? null };
		case 'rollup': {
			const source = doc.fields.find((one) => one.id === field.rollupSourceFieldId);
			const other = tableFor(
				source?.type === 'relationBack' ? source.backPath : source?.linkPath,
			);
			return {
				gathersThrough: source?.name ?? null,
				reads: nameIn(other, field.rollupFieldId),
				aggregate: field.rollupAggregate ?? null,
			};
		}
		case 'lookup': {
			const source = doc.fields.find((one) => one.id === field.lookupSourceFieldId);
			const other = tableFor(
				source?.type === 'relationBack' ? source.backPath : source?.linkPath,
			);
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
 * The column names a formula reads, using the evaluator's own parser so a name in a string is
 * not a column. A formula that does not parse reports none.
 */
function formulaReferences(expression: string): string[] {
	const parsed = parseFormula(expression);
	if (!parsed.ok) {
		return [];
	}
	const names: string[] = [];
	const visit = (node: FormulaNode): void => {
		switch (node.kind) {
			case 'field':
				if (!names.includes(node.name)) {
					names.push(node.name);
				}
				return;
			case 'call':
				for (const argument of node.args) {
					visit(argument);
				}
				return;
			case 'unary':
				visit(node.operand);
				return;
			case 'binary':
				visit(node.left);
				visit(node.right);
				return;
			default:
				return;
		}
	};
	visit(parsed.node);
	return names;
}

/**
 * Why a blank cell reads blank: a missing relation, a nested mapping and a truly empty value
 * all produce empty text.
 */
function readLimit(field: Field): string | null {
	switch (field.type) {
		case 'formula':
			return 'A formula error reads as #<error-code>, not as a value.';
		case 'relationBack':
			return 'Reads empty when the back-reference table or its title column is missing.';
		case 'rollup':
			return 'Reads empty when the source relation, the other table, or the gathered column is missing.';
		case 'lookup':
			return 'Reads empty when the source relation, the other table, or the shown column is missing.';
		case 'noteProp':
			return 'Only top-level scalar frontmatter values and simple arrays are read; nested mappings, missing notes or missing keys read as empty.';
		default:
			return null;
	}
}

/**
 * Where a computed column gets its value, in terms a caller can pass on. Null for a column
 * that is not computed, which this answer does not explain.
 */
function computedFrom(
	doc: LayerDoc,
	field: Field,
	others: Map<string, LayerDoc>,
): Record<string, unknown> | null {
	const tableFor = (path?: string): LayerDoc | null => tableAt(doc, path, others);
	const sourceOf = (
		sourceField: Field | undefined,
	): { path?: string; table: LayerDoc | null } => {
		if (!sourceField) {
			return { table: null };
		}
		const stored =
			sourceField.type === 'relationBack'
				? sourceField.backPath
				: sourceField.linkPath;
		return { path: linkPathForRead(stored), table: tableFor(stored) };
	};
	const described = (
		kind: string,
		table: LayerDoc | null,
		path: string | undefined,
		column: Field | undefined,
		through: string | null,
		extra: Record<string, unknown>,
	): Record<string, unknown> => {
		const where = path ?? 'this table';
		const via = through ? ` through ${through}` : '';
		let explain = `${kind} is not fully configured.`;
		if (column) {
			if (kind === 'relation') {
				explain = `Linked rows show ${column.name} (${column.type}) from ${where}.`;
			} else if (kind === 'relationBack') {
				explain = `Rows in ${where} point back here; their ${column.name} (${column.type}) titles them.`;
			} else if (kind === 'rollup') {
				explain = `Rollup${via} of ${column.name} (${column.type}) in ${where}.`;
			} else if (kind === 'lookup') {
				explain = `Lookup${via} of ${column.name} (${column.type}) in ${where}.`;
			}
		}
		return {
			kind,
			table: path ?? null,
			tableName: table?.name ?? null,
			column: column?.name ?? null,
			columnType: column?.type ?? null,
			columnIsComputed: column ? isDerived(column.type) : false,
			crossTable: Boolean(path),
			through,
			...extra,
			explain,
		};
	};

	switch (field.type) {
		case 'rollup': {
			const source = doc.fields.find((one) => one.id === field.rollupSourceFieldId);
			const resolved = sourceOf(source);
			const column = resolved.table?.fields.find(
				(one) => one.id === field.rollupFieldId,
			);
			return described(
				'rollup',
				resolved.table,
				resolved.path,
				column,
				source?.name ?? null,
				{ aggregate: field.rollupAggregate ?? null },
			);
		}
		case 'lookup': {
			const source = doc.fields.find((one) => one.id === field.lookupSourceFieldId);
			const resolved = sourceOf(source);
			const column = resolved.table?.fields.find(
				(one) => one.id === field.lookupFieldId,
			);
			return described(
				'lookup',
				resolved.table,
				resolved.path,
				column,
				source?.name ?? null,
				{},
			);
		}
		case 'relation': {
			if (!field.linkPath) {
				return null;
			}
			const other = tableFor(field.linkPath);
			const column = other?.fields.find((one) => one.id === field.linkFieldId);
			return described(
				'relation',
				other,
				linkPathForRead(field.linkPath),
				column,
				null,
				{},
			);
		}
		case 'relationBack': {
			if (!field.backPath) {
				return null;
			}
			const other = tableFor(field.backPath);
			const column = other?.fields.find((one) => one.id === field.backTitleFieldId);
			return described(
				'relationBack',
				other,
				linkPathForRead(field.backPath),
				column,
				field.backFieldId ? nameIn(other, field.backFieldId) : null,
				{},
			);
		}
		case 'noteProp':
			return {
				kind: 'noteProp',
				noteColumn: nameIn(doc, field.noteFieldId),
				key: field.frontmatterKey ?? field.name,
				crossTable: false,
				explain: `Read from the frontmatter key "${
					field.frontmatterKey ?? field.name
				}" of the note named in the note column; only simple top-level values are read, and the value is not stored in this table.`,
			};
		case 'formula': {
			const reads = formulaReferences(field.formula ?? '').map((name) => {
				const target = doc.fields.find((one) => one.name === name);
				const origin =
					target &&
					(target.type === 'rollup' ||
						target.type === 'lookup' ||
						target.type === 'relationBack')
						? computedFrom(doc, target, others)
						: null;
				return {
					field: name,
					type: target?.type ?? null,
					computed: target ? isDerived(target.type) : false,
					...(origin?.crossTable === true
						? { table: origin.table, column: origin.column }
						: {}),
				};
			});
			return {
				kind: 'formula',
				expression: field.formula ?? null,
				reads,
				crossTable: reads.some((read) => 'table' in read && read.table !== null),
				explain:
					reads.length === 0
						? 'Computed from other columns by this formula; value is not stored in this table.'
						: `Computed by this formula from ${reads
								.map((read) => `${read.field} (${read.type ?? 'unknown'})`)
								.join(', ')}; value is not stored in this table.`,
			};
		}
		default:
			return null;
	}
}

/**
 * A relation cannot go through the grid's text parser — rows are picked, never typed — so a
 * caller may name a row by id or by the text the relation shows.
 */
function relationCell(
	doc: LayerDoc,
	field: Field,
	raw: unknown,
	others: Map<string, LayerDoc>,
): { ids: string[]; unknown: string[] } {
	const target = tableAt(doc, field.linkPath, others);
	if (!target) {
		throw new Error(
			`The relation column "${field.name}" points at "${field.linkPath ?? ''}", which is not a table in this vault.`,
		);
	}
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

function writeCell(
	doc: LayerDoc,
	recordId: string,
	field: Field,
	raw: unknown,
	others: Map<string, LayerDoc>,
): { ok: boolean; unknown: string[] } {
	// Nothing to write is a clear, not a refusal: a number parser has no empty number, so
	// without this a cell of that type could not be emptied from here.
	if (raw === null || raw === undefined || asText(raw) === '') {
		return {
			ok: setCellValue(doc, recordId, field, emptyValueFor(field)),
			unknown: [],
		};
	}
	if (field.type === 'relation') {
		const { ids, unknown } = relationCell(doc, field, raw, others);
		if (unknown.length > 0) {
			return { ok: false, unknown };
		}
		return { ok: setCellValue(doc, recordId, field, ids), unknown: [] };
	}
	return { ok: setCellFromText(doc, recordId, field, asText(raw)), unknown: [] };
}

/** Why a value cannot be stored, and the sentence the caller owes the reader. */
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

function asTextList(raw: unknown): string[] {
	return Array.isArray(raw)
		? raw
				.filter((one): one is string => typeof one === 'string')
				.map((one) => one.trim())
				.filter((one) => one !== '')
		: [];
}

function asList(raw: unknown): Record<string, unknown>[] {
	return Array.isArray(raw)
		? raw.filter(
				(one): one is Record<string, unknown> =>
					typeof one === 'object' && one !== null,
			)
		: [];
}

/** Whether the caller named the argument, even as null: that is what lets a setting be cleared. */
function given(args: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(args, key);
}

function linkedTable(
	doc: LayerDoc,
	sourceFieldId: string | undefined,
	others: Map<string, LayerDoc>,
): LayerDoc {
	const source = doc.fields.find((one) => one.id === sourceFieldId);
	if (!source) {
		return doc;
	}
	const path =
		source.type === 'relation'
			? source.linkPath
			: source.type === 'relationBack'
				? source.backPath
				: undefined;
	if (!path) {
		return doc;
	}
	const table = tableAt(doc, path, others);
	if (!table) {
		throw new Error(
			`The column "${source.name}" points at "${path}", which is not a table in this vault.`,
		);
	}
	return table;
}

/**
 * The settings one column type carries, applied from whatever the caller passed. A new column
 * or a changed type must be given what it cannot work without; an existing type applies only
 * what it was given.
 */
function applyFieldSettings(
	doc: LayerDoc,
	field: Field,
	args: Record<string, unknown>,
	file: string,
	requireSettings: boolean,
	others: Map<string, LayerDoc>,
): string[] {
	const changed: string[] = [];
	const type = field.type;

	if (type === 'relation') {
		const targetPath = asText(args.targetTable).trim();
		const shown = asText(args.linkField).trim();
		if (shown === '') {
			if (requireSettings) {
				throw new Error(
					'A relation column needs `linkField`: the column of the target table whose values it shows. Ask which column names a row — usually the title or name column.',
				);
			}
		} else {
			// The same file means this table; loading it again would give a second copy of the document.
			const elsewhere = targetPath !== '' && vaultFile(targetPath) !== file;
			const other = elsewhere ? loadTable(targetPath).doc : doc;
			field.linkFieldId = fieldOf(other, shown).id;
			if (elsewhere) {
				field.linkPath = targetPath;
			} else {
				delete field.linkPath;
			}
			changed.push('linkField');
		}
	}

	if (type === 'relationBack') {
		/* The server cannot create a backlink, but the column naming a pointing row is an ordinary setting. */
		if (given(args, 'backTitleField')) {
			const titleName = asText(args.backTitleField).trim();
			if (titleName === '') {
				delete field.backTitleFieldId;
			} else {
				const source = field.backPath
					? tableAt(doc, field.backPath, others)
					: doc;
				if (!source) {
					throw new Error(
						`This backlink column points at "${field.backPath}", which is not a table in this vault.`,
					);
				}
				field.backTitleFieldId = fieldOf(source, titleName).id;
			}
			changed.push('backTitleField');
		}
	}

	if (type === 'formula') {
		const expression = asText(args.formula).trim();
		if (expression === '') {
			if (requireSettings) {
				throw new Error(
					'A formula column needs `formula`, for example {Score} * 2. Ask what it should compute rather than guessing.',
				);
			}
		} else {
			field.formula = expression;
			changed.push('formula');
		}
		const presented = asText(args.formulaType).trim();
		if (presented !== '') {
			if (!FORMULA_TYPES.includes(presented as FormulaResultType)) {
				throw new Error(
					`Unknown formula presentation: ${presented}. Use one of: ${FORMULA_TYPES.join(', ')}.`,
				);
			}
			field.formulaType = presented as FormulaResultType;
			changed.push('formulaType');
		} else if (given(args, 'formulaType')) {
			delete field.formulaType;
			changed.push('formulaType');
		}
	}

	if (type === 'rollup') {
		const sourceName = asText(args.rollupSource).trim();
		if (sourceName !== '') {
			const source = fieldOf(doc, sourceName);
			if (source.type !== 'relation' && source.type !== 'relationBack') {
				throw new Error(
					`A rollup gathers rows through a relation or backlink column, and "${source.name}" is ${source.type}.`,
				);
			}
			field.rollupSourceFieldId = source.id;
			changed.push('rollupSource');
		} else if (requireSettings) {
			throw new Error(
				'A rollup gathers rows through a relation column, so it needs `rollupSource`: the name of that column.',
			);
		}
		const aggregate = asText(args.rollupAggregate).trim();
		if (aggregate === '') {
			if (requireSettings) {
				throw new Error(
					`A rollup needs rollupAggregate, one of: ${ROLLUP_AGGREGATES.join(', ')}.`,
				);
			}
		} else {
			if (!ROLLUP_AGGREGATES.includes(aggregate as RollupAggregate)) {
				throw new Error(
					`A rollup needs rollupAggregate, one of: ${ROLLUP_AGGREGATES.join(', ')}.`,
				);
			}
			field.rollupAggregate = aggregate as RollupAggregate;
			changed.push('rollupAggregate');
		}
		const readName = asText(args.rollupField).trim();
		if (readName === '') {
			if (requireSettings) {
				throw new Error(
					'A rollup needs `rollupField`: the column of the other table to read, such as its amount column.',
				);
			}
		} else {
			field.rollupFieldId = fieldOf(
				linkedTable(doc, field.rollupSourceFieldId, others),
				readName,
			).id;
			changed.push('rollupField');
		}
	}

	if (type === 'lookup') {
		const sourceName = asText(args.lookupSource).trim();
		if (sourceName !== '') {
			const source = fieldOf(doc, sourceName);
			if (source.type !== 'relation' && source.type !== 'relationBack') {
				throw new Error(
					`A lookup reads rows through a relation or backlink column, and "${source.name}" is ${source.type}.`,
				);
			}
			field.lookupSourceFieldId = source.id;
			changed.push('lookupSource');
		} else if (requireSettings) {
			throw new Error(
				'A lookup reads rows through a relation column, so it needs `lookupSource`: the name of that column.',
			);
		}
		const readName = asText(args.lookupField).trim();
		if (readName === '') {
			if (requireSettings) {
				throw new Error(
					'A lookup needs `lookupField`: the column of the other table to show, such as its owner column.',
				);
			}
		} else {
			field.lookupFieldId = fieldOf(
				linkedTable(doc, field.lookupSourceFieldId, others),
				readName,
			).id;
			changed.push('lookupField');
		}
	}

	if (type === 'noteProp') {
		const noteName = asText(args.noteField).trim();
		if (noteName !== '') {
			const noteField = fieldOf(doc, noteName);
			if (noteField.type !== 'note') {
				throw new Error(
					`A note property reads the note a note column points at, and "${noteField.name}" is ${noteField.type}.`,
				);
			}
			field.noteFieldId = noteField.id;
			changed.push('noteField');
		} else if (requireSettings) {
			throw new Error(
				'A note property reads one frontmatter key of the note a `note` column points at, so it needs `noteField`: the name of that note column.',
			);
		}
		if (given(args, 'frontmatterKey')) {
			const key = asText(args.frontmatterKey).trim();
			if (key === '') {
				delete field.frontmatterKey;
			} else {
				field.frontmatterKey = key;
			}
			changed.push('frontmatterKey');
		}
	}

	if (type === 'autoNumber') {
		if (given(args, 'numberLength')) {
			if (typeof args.numberLength === 'number') {
				field.numberLength = Math.max(1, Math.floor(args.numberLength));
			} else {
				delete field.numberLength;
			}
			changed.push('numberLength');
		}
		if (given(args, 'numberGroup')) {
			const groupName = asText(args.numberGroup).trim();
			if (groupName === '') {
				delete field.numberGroupFieldId;
			} else {
				const groupField = fieldOf(doc, groupName);
				if (isDerived(groupField.type)) {
					throw new Error(
						`A numbering column cannot count within "${groupField.name}": that column is computed, so it stores no value to count by.`,
					);
				}
				field.numberGroupFieldId = groupField.id;
			}
			changed.push('numberGroup');
		}
	}

	if (type === 'number') {
		if (given(args, 'numberFormat')) {
			const format = asText(args.numberFormat).trim();
			if (format === '') {
				delete field.numberFormat;
			} else if (format !== 'plain' && format !== 'percent') {
				throw new Error(`Unknown number format: ${format}. Use plain or percent.`);
			} else {
				field.numberFormat = format;
			}
			changed.push('numberFormat');
		}
		if (given(args, 'decimals')) {
			if (typeof args.decimals === 'number') {
				field.decimals = Math.max(0, Math.min(10, Math.floor(args.decimals)));
			} else {
				delete field.decimals;
			}
			changed.push('decimals');
		}
		if (given(args, 'min')) {
			if (typeof args.min === 'number') {
				field.min = args.min;
			} else {
				delete field.min;
			}
			changed.push('min');
		}
		if (given(args, 'max')) {
			if (typeof args.max === 'number') {
				field.max = args.max;
			} else {
				delete field.max;
			}
			changed.push('max');
		}
	}

	return changed;
}

/**
 * A record with cells keyed by column name. Numbering columns store nothing but read as a
 * position, and every other computed value comes through the grid's own `CellReader`, so it
 * arrives as the screen shows it.
 */
function shownRecord(
	doc: LayerDoc,
	record: LayerRecord,
	reader: CellReader,
	numbering?: ReadonlyMap<string, ReadonlyMap<string, string>>,
): Record<string, unknown> {
	const cells: Record<string, CellValue> = {};
	const notes: Record<string, string> = {};
	for (const field of doc.fields) {
		if (field.type === 'autoNumber') {
			const text = numbering?.get(field.id)?.get(record.id);
			if (text !== undefined) {
				cells[field.name] = text;
			}
			continue;
		}
		if (isDerived(field.type)) {
			const reading = reader.reading(doc, field, record);
			if (reading !== null) {
				cells[field.name] = reading.text;
				if (reading.hint !== undefined && reading.hint !== '') {
					notes[field.name] = reading.hint;
				}
			}
			continue;
		}
		const value = record.cells[field.id];
		if (value !== undefined) {
			cells[field.name] = shownValue(field, value);
		}
	}
	return {
		id: record.id,
		cells,
		...(Object.keys(notes).length > 0 ? { notes } : {}),
	};
}

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
 * Anything that is not a scalar reads as nothing rather than `[object Object]`, which a column
 * would then refuse with a confusing message.
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
			`Read a table: its columns, its views, and its rows. Cells are keyed by column name and select values read as option names, so what comes back can be sent straight to update_cells or add_records. Every view is reported with its own filter, sorts and hidden columns — read them before changing a view, because a view is named, not "the one on screen".

A computed column is read back as the value its cell shows. Each field reports \`readable\`, \`writable\`, and — when a value has a limit — \`readLimit\` or \`writeLimit\`. A value that comes from another table — a rollup, lookup or relation showing a computed column — carries \`computedFrom\` with that table, column and type, so you can explain where it came from; it is computed, not stored here. A note property is read from the note's frontmatter through a small top-level YAML subset; nested mappings read as empty and are called out in that row's \`notes\`. A formula error also appears in \`notes\` rather than being mistaken for a value.`,
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
			'Append rows. Each row is an object of column name to value. Values are text as a person would type them: a number is "42", a checkbox is "true" or "false", a date is "2026-01-31", a date and time is "2026-01-31 09:30", a select is the option name, a multi-select is "Red, Blue" or an array of names, and a note column is a vault path like "Folder/Note". A computed column (formula, rollup, lookup, backlinks, note property, numbering) is skipped. A value the column cannot hold comes back in `refused` instead of being written.' +
			WRITE_REVISION_NOTE,
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
			'Set individual cells. A record id comes from read_table; a column may be named or given by id. Values follow the same rules as add_records, and a value the column cannot hold is reported in `refused` rather than written. A computed column cannot be written.' +
			WRITE_REVISION_NOTE,
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
		description: 'Remove rows by id.' + WRITE_REVISION_NOTE,
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
- \`note\` holds a vault path to a note; \`noteProp\` reads one frontmatter key of the note a \`note\` column points at. This server cannot write a \`noteProp\` value.
- \`formula\` computes from other columns; \`rollup\` totals a related table through a relation column; \`relationBack\` lists the rows that point back here; \`lookup\` shows one column of those rows as it reads over there, without totalling anything.

Every type that computes from something else needs that something named, and the call fails rather than storing a column that cannot work: \`relation\` needs \`linkField\` (plus \`targetTable\` when the rows are in another file), \`formula\` needs \`formula\`, \`rollup\` needs \`rollupSource\`, \`rollupField\` and \`rollupAggregate\`, \`lookup\` needs \`lookupSource\` and \`lookupField\`, \`noteProp\` needs \`noteField\`.

**If the type is not obvious from what the reader said, do not guess.** Name two or three candidates, say in one line what each would store for this data, and ask which one they mean. A wrong type silently produces a column that looks right and behaves wrong, which costs far more than one question.

A backlink column (relationBack) is the one type this server cannot create: it needs the relation pointing back at it, which the app sets up. Say so rather than building something similar.

Two limits you have to pass on rather than work around:

- **Dates have no format setting in this plugin.** A date always reads as YYYY-MM-DD and a date-time as YYYY-MM-DD HH:mm. If the reader asks for another format, tell them it is not available; do not silently produce something else.
- **A numbering column is a position, not a stored value.** Each row is counted within its group, in the order the rows sit in the file, so inserting, deleting or regrouping rows renumbers the ones after them. Do not describe it as a permanent id: tell the reader to build a stable id with a formula if they need one.
- **A \`noteProp\` column's values cannot be written from here**, but they can be read: they live in the frontmatter of the note a \`note\` column points at. Create the column if it helps, but tell the reader that filling it in happens in the app. Only top-level scalar frontmatter values are read; nested mappings read as empty.`,
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: PATH_HINT },
				name: { type: 'string' },
				type: { type: 'string', enum: [...FIELD_TYPES] },
				options: {
					type: 'array',
					items: { type: 'string' },
					description:
						'Select and multiSelect only: option names, in order. Each takes the next colour of the palette, as a new option does in the app; add, remove, rename or recolour one later with update_field.',
				},
				required: {
					type: 'boolean',
					description:
						'Whether a cell of this column must not be left empty. The ten types the reader fills in accept it; a computed column refuses it.',
				},
				formulaType: {
					type: 'string',
					enum: [...FORMULA_TYPES],
					description:
						'formula only: how the result is presented. It changes the dressing, never the computed value.',
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
		name: 'update_field',
		description: `Change an existing column. Only the settings you pass are changed; everything else keeps its value — which is the difference between this and deleting the column and adding it again.

Everything the app's column panel can change is here: the name, the type, whether it is required, a number column's format and bounds, a choice column's options (add, remove, rename, recolour), a relation's target and shown column, a formula and how its result is presented, a rollup's source, column and aggregate, a lookup's source and column, a numbering column's digits and grouping, a note property's note column and key, and a backlink's title column.

Two things to say out loud rather than discover later:

- **Changing the type clears the column.** The old values are the wrong shape for the new type, so they are dropped and the call reports the count in its answer. Tell the reader before you do it, not after.
- **Removing an option leaves the cells that held it pointing at a value the column no longer knows.** They read as empty, exactly as they do when an option is removed in the app, and nothing rewrites them.`,
		inputSchema: {
			type: 'object',
			properties: {
				path: { type: 'string', description: PATH_HINT },
				field: { type: 'string', description: 'Column name or id' },
				name: { type: 'string', description: 'New name for the column' },
				type: {
					type: 'string',
					enum: [...FIELD_TYPES],
					description: 'New type. This clears the column, and reports how many cells it dropped.',
				},
				required: {
					type: 'boolean',
					description:
						'Whether a cell must not be left empty. Refused on a computed column.',
				},
				addOptions: {
					type: 'array',
					items: { type: 'string' },
					description:
						'Choice columns: option names to append. Each takes the next palette colour.',
				},
				removeOptions: {
					type: 'array',
					items: { type: 'string' },
					description: 'Choice columns: option names to remove.',
				},
				renameOptions: {
					type: 'array',
					description:
						'Choice columns: options to rename. The option id is kept, so its cells still match.',
					items: {
						type: 'object',
						properties: {
							from: { type: 'string' },
							to: { type: 'string' },
						},
						required: ['from', 'to'],
					},
				},
				setOptionColors: {
					type: 'array',
					description: `Choice columns: option colours. A colour is a palette name (${OPTION_PALETTE.join(', ')}) or a #rrggbb value, which is what the app's colour picker writes.`,
					items: {
						type: 'object',
						properties: {
							name: { type: 'string' },
							color: { type: 'string' },
						},
						required: ['name', 'color'],
					},
				},
				orderOptions: {
					type: 'array',
					items: { type: 'string' },
					description:
						'Choice columns: every option name, in the order they should appear, applied after any options this call adds. This is the order the board draws its columns in and the order a choice column sorts by, so it is the same list the app lets the reader drag. Name each option exactly once.',
				},
				numberFormat: {
					type: 'string',
					enum: ['plain', 'percent', ''],
					description: 'number only: how the value is shown. Pass "" for plain.',
				},
				decimals: {
					type: 'number',
					description: 'number only: decimal places, 0 to 10. Pass null to use as typed.',
				},
				min: { type: 'number', description: 'number only: smallest value. Pass null to remove.' },
				max: { type: 'number', description: 'number only: largest value. Pass null to remove.' },
				targetTable: {
					type: 'string',
					description:
						'relation only: the .layer file whose rows a cell picks from. Pass "" for this table.',
				},
				linkField: {
					type: 'string',
					description: 'relation only: the column of the target table whose values are shown.',
				},
				backTitleField: {
					type: 'string',
					description:
						'relationBack only: the column a pointing row is named by. Pass "" for row numbers.',
				},
				formula: { type: 'string', description: 'formula only: the expression.' },
				formulaType: {
					type: 'string',
					enum: [...FORMULA_TYPES, ''],
					description: 'formula only: how the result is presented. Pass "" to let the result decide.',
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
					enum: [...ROLLUP_AGGREGATES],
					description: 'rollup only: how the gathered values become one number.',
				},
				lookupSource: {
					type: 'string',
					description: 'lookup only: the relation column to read rows through.',
				},
				lookupField: {
					type: 'string',
					description: 'lookup only: the column of the other table to show.',
				},
				noteField: {
					type: 'string',
					description: 'noteProp only: the note column whose file is read.',
				},
				frontmatterKey: {
					type: 'string',
					description:
						'noteProp only: the frontmatter key to read and write. Pass "" to use the column name.',
				},
				numberLength: {
					type: 'number',
					description: 'autoNumber only: how many digits to pad the count to.',
				},
				numberGroup: {
					type: 'string',
					description:
						'autoNumber only: the column whose values are counted separately. Pass "" to count the whole table.',
				},
			},
			required: ['path', 'field'],
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
				rowHeight: {
					type: 'number',
					description:
						'Table only: the height every row starts at, in pixels. Pass null to go back to the default. A row dragged taller keeps its own height.',
				},
				wrap: {
					type: 'boolean',
					description:
						'Table only: whether a cell’s value may run onto more lines, which makes a row taller than the height set for it.',
				},
				summaries: {
					type: 'object',
					description:
						'Table only: what each column footer reports, by column name, as one object for the whole row of footers. A column left out is not summarised. Pass {} to clear them all.',
				},
				colorRules: {
					type: 'array',
					description:
						'Table only: whole-row tints, in priority order — only the first rule a row matches is drawn. Pass [] to clear them.',
					items: {
						type: 'object',
						properties: {
							field: { type: 'string', description: 'Column name or id' },
							operator: { type: 'string', enum: [...FILTER_OPERATORS] },
							value: { type: 'string', description: 'Not needed by isEmpty, isNotEmpty, checked or unchecked.' },
							color: {
								type: 'string',
								enum: [...OPTION_PALETTE],
								description: 'A name from the palette.',
							},
						},
						required: ['field', 'operator', 'color'],
					},
				},
				columnWidths: {
					type: 'object',
					description:
						'Table only: column widths in pixels, by column name. One object for the whole table; a column left out keeps the width it had.',
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
			// Named after the table: this process has no interface language, so a fixed word would
			// be wrong in one of them.
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
			try {
				createFileText(file, serializeLayerDoc(doc));
			} catch (error) {
				// The path was absent a moment ago, but a sync pull can take it between the check
				// and the create; anything else is the real failure.
				if (existsSync(file)) {
					throw new Error(
						`Something is already at "${String(args.path)}"; choose another path. Nothing was written.`,
					);
				}
				throw error;
			}
			return { path: args.path, name: doc.name, fields: 0, records: 0, views: 1 };
		}

		case 'list_tables': {
			// An unreadable table is listed with its reason rather than failing the whole answer.
			const unreadable: { path: string; why: string }[] = [];
			const tables = tableFiles().flatMap((path) => {
				try {
					const { doc } = loadTable(path);
					return [
						{
							path,
							name: doc.name,
							fields: doc.fields.length,
							records: doc.records.length,
							views: doc.views.length,
						},
					];
				} catch (error) {
					unreadable.push({
						path,
						why: error instanceof Error ? error.message : String(error),
					});
					return [];
				}
			});
			return unreadable.length > 0
				? { vault: VAULT, tables, unreadable }
				: { vault: VAULT, tables };
		}

		case 'read_table': {
			const { doc } = loadTable(args.path);
			// Loaded at most once per table, however many columns point at it.
			const otherTables = new Map<string, LayerDoc>();
			const tablePaths = tableFiles();
			// Cached for this call only: text kept longer would be what the note held when it was
			// first read.
			const noteTexts = new Map<string, string | null>();
			const noteText = (notePath: string): string | null => {
				const cached = noteTexts.get(notePath);
				if (cached !== undefined) {
					return cached;
				}
				const file = resolveNoteFile(notePath);
				let text: string | null = null;
				if (file !== null) {
					try {
						text = readFileText(file);
					} catch {
						text = null;
					}
				}
				noteTexts.set(notePath, text);
				return text;
			};
			const reader = new CellReader({
				table: (field, from, direction) => {
					const path = direction === 'back' ? field.backPath : field.linkPath;
					if (!path) {
						return from;
					}
					const resolved = tablePathForRead(path, tablePaths);
					if (!resolved) {
						return null;
					}
					// Read and parsed once per table for the whole answer.
					const cached = otherTables.get(resolved);
					if (cached) {
						return cached;
					}
					try {
						const loaded = loadTable(resolved).doc;
						otherTables.set(resolved, loaded);
						return loaded;
					} catch {
						return null;
					}
				},
				noteProperty: (notePath, key) => {
					const text = noteText(notePath);
					return text === null ? '' : frontmatterValue(text, key);
				},
				notePropertyHint: () =>
					'This frontmatter value is nested or otherwise too complex to read; only top-level scalar values and simple arrays can be read.',
				formulaError: (error) => ({
					text: `#${error.code}`,
					hint: error.detail ?? error.code,
				}),
			});
			const offset = typeof args.offset === 'number' ? Math.max(0, args.offset) : 0;
			const limit = typeof args.limit === 'number' ? Math.max(0, args.limit) : 100;
			// A relation cell holds row ids, which mean nothing on their own; list the labels so a
			// caller knows which row is which.
			const rowLabels: Record<string, string> = {};
			for (const field of doc.fields) {
				if (field.type !== 'relation') {
					continue;
				}
				const target = tableAt(doc, field.linkPath, otherTables);
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
					rowLabels[record.id] = reader.displayText(target, shown, record);
				}
			}

			// A numbering column stores nothing, but its position is reported all the same.
			const numbering = numberingOf(doc);
			return {
				path: args.path,
				name: doc.name,
				fields: doc.fields.map((field) => {
					const config = fieldConfig(doc, field, otherTables);
					const origin = computedFrom(doc, field, otherTables);
					const limit = readLimit(field);
					return {
						id: field.id,
						name: field.name,
						type: field.type,
						readable: true,
						writable: !isDerived(field.type),
						...(limit ? { readLimit: limit } : {}),
						...(field.type === 'noteProp'
							? {
									writeLimit:
										'Frontmatter values can only be edited in the note or the app; MCP cannot write them.',
								}
							: {}),
						...(field.options
							? { options: field.options.map((option) => option.name) }
							: {}),
						...(Object.keys(config).length > 0 ? { config } : {}),
						...(isDerived(field.type) ? { computed: true } : {}),
						...(origin ? { computedFrom: origin } : {}),
					};
				}),
				views: doc.views.map((view) => shownView(doc, view)),
				total: doc.records.length,
				...(Object.keys(rowLabels).length > 0 ? { rowLabels } : {}),
				records: doc.records
					.slice(offset, offset + limit)
					.map((record) => shownRecord(doc, record, reader, numbering)),
			};
		}

		case 'add_records': {
			const { doc, file, text } = loadTable(args.path);
			const others = new Map<string, LayerDoc>();
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
					const result = writeCell(doc, record.id, field, value, others);
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
			saveTable(file, doc, text);
			return { added, refused, skipped };
		}

		case 'update_cells': {
			const { doc, file, text } = loadTable(args.path);
			const others = new Map<string, LayerDoc>();
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
				const result = writeCell(doc, recordId, field, item.value, others);
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
			saveTable(file, doc, text);
			return { updated, refused };
		}

		case 'delete_records': {
			const { doc, file, text } = loadTable(args.path);
			const ids = Array.isArray(args.recordIds)
				? args.recordIds.filter((id): id is string => typeof id === 'string')
				: [];
			const removed = removeRecords(doc, ids);
			saveTable(file, doc, text);
			return { removed };
		}

		case 'add_field': {
			const { doc, file, text } = loadTable(args.path);
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
				// Collected as they are made: reading `field.options` here would still be empty,
				// and each takes the palette colour the app gives a new option, not `default`.
				const taken: string[] = [];
				const options: SelectOption[] = [];
				for (const optionName of names) {
					options.push({
						id: newId('o', taken),
						name: optionName,
						color: nextOptionColor(options),
					});
				}
				field.options = options;
			}

			if (type === 'relationBack') {
				throw new Error(
					'A backlink column has to name the relation that points at it, which this server cannot set up. Tell the user plainly that this column type has to be created in the Obsidian app, and that nothing was created here.',
				);
			}

			if (args.required === true) {
				// Required is a promise about the reader's own typing, so it is offered only where
				// the reader fills the cell in — the same rule the field panel follows.
				if (!canBeRequired(type)) {
					throw new Error(
						`A ${type} column cannot be marked required: the table computes it, so it is never the reader's to leave empty.`,
					);
				}
				field.required = true;
			}

			// Everything the type carries, refused rather than stored half-built.
			applyFieldSettings(doc, field, args, file, true, new Map());

			addField(doc, field);
			saveTable(file, doc, text);
			// The column exists but cannot be filled from here; the caller owes the reader that
			// sentence now, not after the first value.
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

		case 'update_field': {
			const { doc, file, text } = loadTable(args.path);
			const field = fieldOf(doc, args.field);
			const changed: string[] = [];
			let droppedCells = 0;

			if (typeof args.name === 'string' && args.name.trim() !== '') {
				field.name = args.name.trim();
				changed.push('name');
			}

			const nextType = asText(args.type).trim();
			let typeChanged = false;
			if (nextType !== '' && nextType !== field.type) {
				if (!FIELD_TYPES.includes(nextType as FieldType)) {
					throw new Error(`Unknown column type: ${nextType}`);
				}
				// The old values are the wrong shape for the new type, so they go; the count
				// travels back so the caller can own that loss.
				droppedCells = changeFieldType(doc, field.id, nextType as FieldType);
				typeChanged = true;
				changed.push('type');
			}

			if (typeof args.required === 'boolean') {
				if (args.required && !canBeRequired(field.type)) {
					throw new Error(
						`A ${field.type} column cannot be marked required: the table computes it, so it is never the reader's to leave empty.`,
					);
				}
				if (args.required) {
					field.required = true;
				} else {
					delete field.required;
				}
				changed.push('required');
			}

			// A computed column is never the reader's to leave empty, so the flag goes with the type.
			if (field.required === true && !canBeRequired(field.type)) {
				delete field.required;
				changed.push('required');
			}

			if (field.type === 'select' || field.type === 'multiSelect') {
				for (const name of asTextList(args.addOptions)) {
					appendOption(field, name);
					changed.push(`+option:${name}`);
				}
				for (const name of asTextList(args.removeOptions)) {
					if (!removeOption(field, name)) {
						throw new Error(
							`No option named "${name}" on "${field.name}". Nothing was changed.`,
						);
					}
					changed.push(`-option:${name}`);
				}
				for (const one of asList(args.renameOptions)) {
					const from = asText(one.from).trim();
					const to = asText(one.to).trim();
					if (!renameOption(field, from, to)) {
						throw new Error(
							`Could not rename option "${from}" to "${to}" on "${field.name}". Nothing was changed.`,
						);
					}
					changed.push(`rename:${from}`);
				}
				for (const one of asList(args.setOptionColors)) {
					const name = asText(one.name).trim();
					const color = asText(one.color).trim();
					if (normaliseOptionColor(color) === null) {
						throw new Error(
							`"${color}" is not a colour this plugin can draw. Use a palette name (${OPTION_PALETTE.join(', ')}) or a #rrggbb value.`,
						);
					}
					if (!setOptionColor(field, name, color)) {
						throw new Error(
							`No option named "${name}" on "${field.name}". Nothing was changed.`,
						);
					}
					changed.push(`colour:${name}`);
				}
				if (Array.isArray(args.orderOptions)) {
					// A whole order, not a move: a partial one is ambiguous about the options it leaves
					// out. Applied after this call's additions, so add and place can go together.
					const names = asTextList(args.orderOptions);
					const current = field.options ?? [];
					if (names.length !== current.length) {
						throw new Error(
							`Reordering needs every option name exactly once: "${field.name}" has ${current.length} option(s) and ${names.length} name(s) were given. Nothing was changed.`,
						);
					}
					const remaining = [...current];
					const ordered: SelectOption[] = [];
					for (const name of names) {
						const at = remaining.findIndex(
							(option) =>
								option.name.trim().toLowerCase() === name.toLowerCase(),
						);
						if (at < 0) {
							throw new Error(
								`"${name}" is not an option of "${field.name}", or it was already named. Nothing was changed.`,
							);
						}
						const moved = remaining.splice(at, 1)[0];
						if (moved) {
							ordered.push(moved);
						}
					}
					field.options = ordered;
					changed.push('option order');
				}
			}

			changed.push(...applyFieldSettings(doc, field, args, file, typeChanged, new Map()));

			if (changed.length === 0) {
				return {
					id: field.id,
					name: field.name,
					type: field.type,
					changed,
					note: 'Nothing to change. Pass the settings you want changed.',
				};
			}

			saveTable(file, doc, text);
			return {
				id: field.id,
				name: field.name,
				type: field.type,
				changed,
				...(droppedCells > 0
					? {
							droppedCells,
							tellUser: `Changing this column's type cleared ${droppedCells} cell(s) that held the old type.`,
						}
					: {}),
			};
		}

		case 'delete_field': {
			const { doc, file, text } = loadTable(args.path);
			const field = fieldOf(doc, args.field);
			const removed = removeField(doc, field.id);
			saveTable(file, doc, text);
			return { removed, name: field.name };
		}

		case 'add_view': {
			const { doc, file, text } = loadTable(args.path);
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
			saveTable(file, doc, text);
			return { id: view.id, name: view.name, groupByFieldId: view.groupByFieldId };
		}

		case 'update_view': {
			const { doc, file, text } = loadTable(args.path);
			const view = viewOf(doc, args.view);
			if (typeof args.name === 'string' && args.name.trim() !== '') {
				renameView(doc, view.id, args.name.trim());
			}
			if (args.filter !== undefined) {
				view.filter = filterOf(doc, args.filter);
			}
			if (args.sorts !== undefined) {
				view.sorts = sortsOf(doc, args.sorts);
			}
			if (args.hiddenFields !== undefined) {
				view.hiddenFieldIds = fieldIdsOf(doc, args.hiddenFields);
			}
			// A setting stored for a view that cannot show it is one nobody can see or change.
			const tableOnly =
				args.rowHeight !== undefined ||
				args.wrap !== undefined ||
				args.summaries !== undefined ||
				args.colorRules !== undefined ||
				args.columnWidths !== undefined;
			if (tableOnly && view.type !== 'grid') {
				throw new Error(
					'Row height, wrapping, footers, colour rules and column widths belong to a table view',
				);
			}
			if (view.type === 'grid') {
				if (given(args, 'rowHeight')) {
					if (typeof args.rowHeight === 'number') {
						view.rowHeight = Math.max(1, Math.round(args.rowHeight));
					} else {
						// Back to the preset the reader would get by choosing one.
						delete view.rowHeight;
					}
				}
				if (given(args, 'wrap')) {
					if (args.wrap === true || args.wrap === false) {
						view.wrap = args.wrap;
					} else {
						delete view.wrap;
					}
				}
				if (given(args, 'summaries')) {
					view.summaries = summariesOf(doc, args.summaries);
				}
				if (given(args, 'colorRules')) {
					view.colorRules = colorRulesOf(doc, args.colorRules);
				}
				if (given(args, 'columnWidths')) {
					view.columnWidths = widthsOf(doc, args.columnWidths);
				}
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
			saveTable(file, doc, text);
			return shownView(doc, view);
		}

		case 'delete_view': {
			const { doc, file, text } = loadTable(args.path);
			const view = viewOf(doc, args.view);
			const removed = removeView(doc, view.id);
			saveTable(file, doc, text);
			return { removed, name: view.name };
		}

		default:
			throw new Error(`Unknown tool: ${name}`);
	}
}

function send(message: unknown): void {
	proc.stdout.write(`${JSON.stringify(message)}\n`);
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
				// `check-version` keeps this equal to manifest.json, so a release cannot leave it behind.
				serverInfo: { name: 'layer-base', version: '0.1.2' },
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

if (!proc.env.LAYER_VAULT && !proc.argv[2]) {
	console.error('[layer-mcp] Set LAYER_VAULT to the vault folder.');
	proc.exit(1);
}

let buffer = '';
proc.stdin.setEncoding('utf8');
proc.stdin.on('data', (chunk: string) => {
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
