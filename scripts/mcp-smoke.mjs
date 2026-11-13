import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * The MCP server has no unit tests: it is a process, and what is worth checking is
 * what it writes to disk. This drives it over stdin the way a client does and checks
 * the files it leaves behind, so a broken server cannot reach a release.
 */

const vault = mkdtempSync(join(tmpdir(), 'layer-mcp-'));
const failures = [];

function check(condition, message) {
	if (!condition) {
		failures.push(message);
	}
}

/*
 * The built server, found from this file rather than from the working directory:
 * a relative path is resolved against wherever the run was started, so the same
 * script worked under `npm run test:mcp` and failed with ENOENT from any other
 * directory.
 */
const SERVER = fileURLToPath(new URL('../mcp-server.cjs', import.meta.url));

/* Long enough that a working server never reaches it, short enough that a stuck
 * one is reported rather than holding a CI job open. */
const TIMEOUT_MS = 30_000;

/** The exit of a server that did not finish the run, in one line. */
function describeExit(code, signal, err) {
	const how = signal === null ? `code ${code}` : `signal ${signal}`;
	const trace = err.trim().replace(/\s*\n\s*/g, ' | ');
	return `the server exited with ${how}${trace === '' ? '' : `: ${trace.slice(0, 400)}`}`;
}

/** The JSON-RPC messages on stdout, one per line. */
function parseMessages(out) {
	return out
		.split('\n')
		.filter((line) => line.trim() !== '')
		.map((line) => {
			try {
				return JSON.parse(line);
			} catch {
				throw new Error(`the server wrote a line that is not JSON: ${line.slice(0, 200)}`);
			}
		});
}

/**
 * Reports a run that could not be driven at all, and stops: every check below
 * would only repeat that the answers are missing. Without this a rejected
 * `drive` reaches the top level as an uncaught error, which prints a stack, skips
 * the report and leaves the temp folder behind.
 */
function stop(message) {
	console.error(`mcp smoke: ${message}`);
	try {
		rmSync(vault, { recursive: true, force: true });
	} catch {
		/* A server killed a moment ago may still hold a file; the report matters more. */
	}
	process.exit(1);
}

function drive(calls) {
	return new Promise((resolve, reject) => {
		const server = spawn(process.execPath, [SERVER], {
			env: { ...process.env, LAYER_VAULT: vault },
			stdio: ['pipe', 'pipe', 'pipe'],
		});

		const timer = setTimeout(() => {
			server.kill('SIGKILL');
			reject(new Error(`the server did not finish within ${TIMEOUT_MS / 1000}s`));
		}, TIMEOUT_MS);

		let out = '';
		let err = '';
		server.stdout.setEncoding('utf8');
		server.stderr.setEncoding('utf8');
		server.stdout.on('data', (chunk) => {
			out += chunk;
		});
		server.stderr.on('data', (chunk) => {
			err += chunk;
		});
		/*
		 * A server that dies while stdin is still open answers the next write with
		 * EPIPE, which would otherwise arrive as an uncaught error on the stream.
		 * The exit handler below says what actually happened.
		 */
		server.stdin.on('error', () => {});
		server.on('error', (error) => {
			clearTimeout(timer);
			reject(error);
		});
		server.on('close', (code, signal) => {
			clearTimeout(timer);
			/*
			 * Answers alone are not a passing run: a server that wrote everything
			 * and then died of something else did not do the job.
			 */
			if (code !== 0) {
				reject(new Error(describeExit(code, signal, err)));
				return;
			}
			try {
				resolve({ messages: parseMessages(out), err });
			} catch (error) {
				reject(error);
			}
		});

		for (const call of calls) {
			server.stdin.write(`${JSON.stringify(call)}\n`);
		}
		server.stdin.end();
	});
}

const call = (id, name, args) => ({
	jsonrpc: '2.0',
	id,
	method: 'tools/call',
	params: { name, arguments: args },
});

const { messages, err } = await drive([
	{ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
	{ jsonrpc: '2.0', id: 2, method: 'tools/list' },
	call(3, 'create_table', { path: 'nested/新表.layer', name: '新表' }),
	call(4, 'add_field', { path: 'nested/新表.layer', name: '标题', type: 'text' }),
	call(5, 'add_records', { path: 'nested/新表.layer', records: [{ 标题: '第一行' }] }),
	call(6, 'read_table', { path: 'nested/新表.layer' }),
	call(7, 'create_table', { path: 'nested/新表.layer' }),
	call(8, 'read_table', { path: '../escape.layer' }),
	/*
	 * A new table's view is named after the table, not "Table": this process has no
	 * interface language, so a fixed word would be wrong in one of them. The view is
	 * addressed the way a caller finds it — by the name `read_table` reports.
	 */
	call(9, 'update_view', { path: 'nested/新表.layer', view: '新表', sorts: [{ field: '标题', order: 'desc' }] }),
	call(10, 'add_field', { path: 'nested/新表.layer', name: '编号', type: 'autoNumber', numberLength: 2 }),
	call(11, 'add_records', {
		path: 'nested/新表.layer',
		records: [{ 标题: '第二行' }, { 标题: '第三行' }],
	}),
	call(12, 'read_table', { path: 'nested/新表.layer' }),
	call(13, 'create_table', { path: 'probe/选项.layer', name: '选项' }),
	call(14, 'add_field', { path: 'probe/选项.layer', name: '名称', type: 'text' }),
	call(15, 'add_field', { path: 'probe/选项.layer', name: '状态', type: 'select', options: ['红', '绿', '蓝'] }),
	call(16, 'add_field', { path: 'probe/选项.layer', name: '数量', type: 'number' }),
	call(17, 'add_field', { path: 'probe/选项.layer', name: '合计', type: 'formula', formula: '{数量} * 2', formulaType: 'number' }),
	call(18, 'add_records', { path: 'probe/选项.layer', records: [{ 名称: '甲', 状态: '红', 数量: 5 }] }),
	call(19, 'update_field', {
		path: 'probe/选项.layer',
		field: '状态',
		addOptions: ['黄'],
		removeOptions: ['蓝'],
		renameOptions: [{ from: '红', to: '赤' }],
		setOptionColors: [{ name: '绿', color: '#123456' }],
	}),
	call(20, 'update_field', {
		path: 'probe/选项.layer',
		field: '数量',
		numberFormat: 'percent',
		decimals: 1,
		min: 0,
		max: 100,
	}),
	call(21, 'update_field', { path: 'probe/选项.layer', field: '合计', required: true }),
	call(22, 'update_field', { path: 'probe/选项.layer', field: '名称', required: true }),
	call(23, 'read_table', { path: 'probe/选项.layer' }),
	call(24, 'read_table', { path: 'probe/选项.layer' }),
	call(25, 'update_view', {
		path: 'probe/选项.layer',
		view: '选项',
		rowHeight: 56,
		wrap: true,
		summaries: { 数量: 'sum' },
		colorRules: [{ field: '状态', operator: 'contains', value: '赤', color: 'red' }],
		columnWidths: { 名称: 200 },
	}),
	call(26, 'update_field', { path: 'probe/选项.layer', field: '名称', type: 'autoNumber' }),
	call(27, 'update_field', {
		path: 'probe/选项.layer',
		field: '状态',
		orderOptions: ['黄', '赤', '绿'],
	}),
	/*
	 * The order has to name every option exactly once; a partial list leaves the rest
	 * in no defined place, so it is refused rather than guessed at.
	 */
	call(28, 'update_field', {
		path: 'probe/选项.layer',
		field: '状态',
		orderOptions: ['黄', '赤'],
	}),
	/*
	 * Two dots at the front of a name are a name, not a way out of the vault: only
	 * the parent itself (`..`) and anything past it are refused.
	 */
	call(29, 'create_table', { path: '..draft.layer', name: '..draft' }),
	/*
	 * Changing a column's type drops the settings the old type owned, so the new
	 * type's settings have to come with the change: without a source the column
	 * could never compute anything.
	 */
	call(30, 'update_field', {
		path: 'nested/新表.layer',
		field: '编号',
		type: 'lookup',
	}),
]).catch((error) => stop(error.message));

const byId = new Map(messages.map((message) => [message.id, message]));
const textOf = (id) => byId.get(id)?.result?.content?.[0]?.text ?? '';
const isError = (id) => byId.get(id)?.result?.isError === true;

check(byId.has(1), 'initialize answered');
check(byId.has(2), 'tools/list answered');

const toolNames = (byId.get(2)?.result?.tools ?? []).map((tool) => tool.name);
for (const expected of [
	'list_tables',
	'create_table',
	'read_table',
	'add_records',
	'update_cells',
	'delete_records',
	'add_field',
	'delete_field',
	'add_view',
	'update_view',
	'delete_view',
]) {
	check(toolNames.includes(expected), `tools/list offers ${expected}`);
}

check(!isError(3), 'create_table succeeded');
check(!isError(4), 'add_field succeeded');
check(!isError(5), 'add_records succeeded');
check(!isError(6), 'read_table succeeded');
check(isError(7), 'create_table refuses an existing path');
check(isError(8), 'a path outside the vault is refused');
check(!isError(9), 'update_view sets a sort');
check(!isError(10), 'add_field accepts a numbering column');
check(!isError(11), 'add_records accepts rows beside a numbering column');
check(!isError(12), 'read_table reads a table with a numbering column');
check(toolNames.includes('update_field'), 'tools/list offers update_field');
check(
	[13, 14, 15, 16, 17].every((id) => !isError(id)),
	'the second table was built',
);
check(!isError(18), 'a row was added to it');
check(!isError(19), 'update_field changes a choice column');
check(!isError(20), 'update_field changes a number column');
check(isError(21), 'a computed column refuses to be marked required');
check(!isError(22), 'a text column can be marked required');
check(!isError(25), 'update_view sets the table’s row height, wrapping, footers and tints');
check(
	!isError(26) && textOf(26).includes('droppedCells'),
	'a type change reports the cells it dropped',
);
check(textOf(19).includes('+option:'), 'update_field reports the option it added');
check(
	!isError(27) && textOf(27).includes('option order'),
	'update_field reorders a choice column',
);
check(isError(28), 'a partial option order is refused');
check(!isError(29), 'a name beginning with two dots is a name, not an escape');
check(
	isError(30) && textOf(30).includes('lookupSource'),
	'a type change to a computed column asks for the setting it cannot work without',
);
check(
	!textOf(24).includes('"unreadable"'),
	'read_table no longer marks a computed column unreadable',
);

check(textOf(3).includes('新表'), 'create_table reports the name it used');
check(textOf(6).includes('第一行'), 'read_table returns the row that was written');
check(textOf(9).includes('desc'), 'update_view reports the sort it stored');

try {
	const table = JSON.parse(textOf(12));
	const numbers = table.records.map((record) => record.cells['编号']);
	check(
		numbers.join(',') === '01,02,03',
		`read_table reports a position per row, got ${numbers.join(',')}`,
	);
} catch (error) {
	failures.push(`read_table did not answer with JSON: ${String(error)}`);
}

let doc = null;
try {
	doc = JSON.parse(readFileSync(join(vault, 'nested', '新表.layer'), 'utf8'));
} catch (error) {
	failures.push(`the new table could not be read: ${String(error)}`);
}

if (doc !== null) {
	check(doc.version === 1, 'the file declares version 1');
	check(Array.isArray(doc.fields) && doc.fields.length === 2, 'both columns were written');
	check(Array.isArray(doc.records) && doc.records.length === 3, 'three rows were written');
	check(
		Array.isArray(doc.views) && doc.views.some((view) => view.type === 'grid'),
		'a table view was written',
	);
	const numbering = doc.fields.find((field) => field.name === '编号');
	check(
		numbering !== undefined &&
			doc.records.every((record) => record.cells[numbering.id] === undefined),
		'a numbering column stores nothing',
	);
}

/*
 * The row id the rest of the run needs. The answer to `read_table` may be an error
 * message or a body of another shape, so anything unexpected is reported once here
 * and leaves the id empty.
 */
function firstRowId() {
	try {
		const id = JSON.parse(textOf(24)).records[0]?.id ?? '';
		if (id === '') {
			failures.push('read_table returned no row, so the cell-clearing check was skipped');
		}
		return id;
	} catch (error) {
		failures.push(`read_table did not answer with JSON: ${String(error)}`);
		return '';
	}
}

/*
 * Clearing a cell needs a row id, so this phase runs only on one that was read
 * back: asking the server to update an empty id would report a second problem
 * that the empty id itself invented.
 */
const firstRow = firstRowId();
if (firstRow !== '') {
	const cleared = await drive([
		call(1, 'update_cells', {
			path: 'probe/选项.layer',
			updates: [{ recordId: firstRow, field: '数量', value: '' }],
		}),
	]).catch((error) => stop(error.message));
	const clearedText = cleared.messages[0]?.result?.content?.[0]?.text ?? '';
	check(cleared.messages[0]?.result?.isError !== true, 'update_cells accepts the row id');
	check(clearedText.includes('"updated": 1'), 'an empty string clears a cell');
}

let probeDoc = null;
try {
	probeDoc = JSON.parse(readFileSync(join(vault, 'probe', '选项.layer'), 'utf8'));
} catch (error) {
	failures.push(`the second table could not be read: ${String(error)}`);
}

if (probeDoc !== null) {
	const status = probeDoc.fields.find((field) => field.name === '状态');
	const names = (status?.options ?? []).map((option) => option.name);
	check(
		names.length === 3 &&
			names.includes('赤') &&
			names.includes('黄') &&
			!names.includes('蓝'),
		`an option was added, renamed and removed: ${names.join(',')}`,
	);
	const green = (status?.options ?? []).find((option) => option.name === '绿');
	check(green?.color === '#123456', 'an option colour was stored as given');
	check(
		names.join(',') === '黄,赤,绿',
		`the option order was written: ${names.join(',')}`,
	);
	check(
		(status?.options ?? []).every((option) => option.color !== 'default'),
		'a new option takes a palette colour',
	);

	const amount = probeDoc.fields.find((field) => field.name === '数量');
	check(
		amount?.numberFormat === 'percent' &&
			amount?.decimals === 1 &&
			amount?.min === 0 &&
			amount?.max === 100,
		'the number settings were written',
	);
	check(
		amount !== undefined && probeDoc.records[0]?.cells[amount.id] === undefined,
		'the cleared number cell holds nothing',
	);

	const renamed = probeDoc.fields.find((field) => field.name === '名称');
	check(renamed?.type === 'autoNumber', 'the type change was written');

	const view = probeDoc.views[0];
	check(view?.rowHeight === 56 && view?.wrap === true, 'the table view settings were written');
	check(
		amount !== undefined && view?.summaries?.[amount.id] === 'sum',
		'the footer choice was written',
	);
	check(
		Array.isArray(view?.colorRules) && view.colorRules.length === 1,
		'the colour rule was written',
	);
	check(
		renamed !== undefined && view?.columnWidths?.[renamed.id] === 200,
		'a column width was written',
	);

	/*
	 * A write has to start from the file as it is now, not from the version an
	 * earlier call saw. Change the file between two server runs and check that
	 * both the outside column and the MCP cell survive.
	 */
	const external = JSON.parse(JSON.stringify(probeDoc));
	external.fields.push({ id: 'f_external', name: '外部列', type: 'text' });
	writeFileSync(
		join(vault, 'probe', '选项.layer'),
		JSON.stringify(external, null, '\t'),
		'utf8',
	);
	const afterExternal = await drive([
		call(1, 'update_cells', {
			path: 'probe/选项.layer',
			updates: [
				{
					recordId: external.records[0]?.id ?? '',
					field: '外部列',
					value: '写入了',
				},
			],
		}),
	]).catch((error) => stop(error.message));
	check(
		afterExternal.messages[0]?.result?.isError !== true,
		'update_cells writes after an external edit',
	);
	let merged = null;
	try {
		merged = JSON.parse(readFileSync(join(vault, 'probe', '选项.layer'), 'utf8'));
	} catch (error) {
		failures.push(`the externally edited table could not be read: ${String(error)}`);
	}
	if (merged !== null) {
		check(
			merged.fields.some((field) => field.name === '外部列'),
			'an external column survives an MCP write',
		);
		const mergedAmount = merged.fields.find((field) => field.name === '外部列');
		check(
			mergedAmount !== undefined &&
				merged.records[0]?.cells[mergedAmount.id] === '写入了',
			'the MCP update landed beside the external change',
		);
	}
}

/*
 * The computed columns another table contributes to. The target table stores the
 * numbers; the main table reaches them through a relation and reads a rollup,
 * a lookup and a formula over that rollup. The answer has to hold both the values
 * and the `computedFrom` chain that says where they came from. A note property is
 * read from a real note in the temporary vault, not from the `.layer` file.
 */
mkdirSync(join(vault, 'computed'), { recursive: true });
writeFileSync(join(vault, 'computed', 'Note.md'), '---\nstatus: done\n---\n');
const computedRun = await drive([
	call(1, 'create_table', { path: 'computed/来源.layer', name: '来源' }),
	call(2, 'add_field', { path: 'computed/来源.layer', name: '名称', type: 'text' }),
	call(3, 'add_field', { path: 'computed/来源.layer', name: '金额', type: 'number' }),
	call(4, 'add_records', {
		path: 'computed/来源.layer',
		records: [{ 名称: '甲', 金额: '2' }, { 名称: '乙', 金额: '4' }],
	}),
	call(5, 'create_table', { path: 'computed/主表.layer', name: '主表' }),
	call(6, 'add_field', { path: 'computed/主表.layer', name: '标题', type: 'text' }),
	call(7, 'add_field', {
		path: 'computed/主表.layer',
		name: '条目',
		type: 'relation',
		targetTable: 'computed/来源.layer',
		linkField: '名称',
	}),
	call(8, 'add_records', {
		path: 'computed/主表.layer',
		records: [{ 标题: '订单一', 条目: ['甲', '乙'] }],
	}),
	call(9, 'add_field', {
		path: 'computed/主表.layer',
		name: '汇总',
		type: 'rollup',
		rollupSource: '条目',
		rollupField: '金额',
		rollupAggregate: 'sum',
	}),
	call(10, 'add_field', {
		path: 'computed/主表.layer',
		name: '查找金额',
		type: 'lookup',
		lookupSource: '条目',
		lookupField: '金额',
	}),
	call(11, 'add_field', {
		path: 'computed/主表.layer',
		name: '翻倍',
		type: 'formula',
		formula: '{汇总} * 2',
		formulaType: 'number',
	}),
	call(12, 'add_field', { path: 'computed/主表.layer', name: '笔记', type: 'note' }),
	call(13, 'add_field', {
		path: 'computed/主表.layer',
		name: '笔记状态',
		type: 'noteProp',
		noteField: '笔记',
		frontmatterKey: 'status',
	}),
]).catch((error) => stop(error.message));

const computedById = new Map(computedRun.messages.map((message) => [message.id, message]));
const computedText = (id) => computedById.get(id)?.result?.content?.[0]?.text ?? '';
const computedError = (id) => computedById.get(id)?.result?.isError === true;

check(
	[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].every((id) => !computedError(id)),
	'the computed-column fixture was built',
);

const noteRun = await drive([
	call(1, 'update_cells', {
		path: 'computed/主表.layer',
		updates: [
			{
				recordId: JSON.parse(computedText(8)).added?.[0] ?? '',
				field: '笔记',
				value: 'computed/Note',
			},
		],
	}),
	call(2, 'read_table', { path: 'computed/主表.layer' }),
]).catch((error) => stop(error.message));
const noteById = new Map(noteRun.messages.map((message) => [message.id, message]));
const noteText = (id) => noteById.get(id)?.result?.content?.[0]?.text ?? '';
const noteError = (id) => noteById.get(id)?.result?.isError === true;
check(!noteError(1), 'update_cells writes a note path');
check(!noteError(2), 'read_table reads a table with computed columns');

let computedDoc = null;
try {
	computedDoc = JSON.parse(noteText(2));
} catch (error) {
	failures.push(`the computed read did not return JSON: ${String(error)}`);
}
if (computedDoc !== null) {
	const cells = computedDoc.records?.[0]?.cells ?? {};
	check(cells['汇总'] === '6', `a rollup reads its total: ${cells['汇总']}`);
	check(cells['查找金额'] === '2, 4', `a lookup reads both values: ${cells['查找金额']}`);
	check(cells['翻倍'] === '12', `a formula reads the rollup as a number: ${cells['翻倍']}`);
	check(cells['笔记状态'] === 'done', `a note property reads its frontmatter: ${cells['笔记状态']}`);
	const total = (computedDoc.fields ?? []).find((field) => field.name === '汇总');
	check(
		total?.computedFrom?.table === 'computed/来源.layer' &&
			total?.computedFrom?.column === '金额',
		'a computed column names the table and column it reads',
	);
	const doubled = (computedDoc.fields ?? []).find((field) => field.name === '翻倍');
	check(
		doubled?.computedFrom?.reads?.some(
			(read) => read.field === '汇总' && read.computed === true,
		) === true,
		'a formula names the computed column it reads',
	);
	const titleField = (computedDoc.fields ?? []).find((field) => field.name === '标题');
	check(
		titleField?.readable === true && titleField?.writable === true,
		'a stored column says it is readable and writable',
	);
	check(
		doubled?.writable === false && String(doubled?.readLimit).includes('error'),
		'a formula says it is read-only and names its error limit',
	);
	const noteField = (computedDoc.fields ?? []).find((field) => field.name === '笔记状态');
	check(
		noteField?.writable === false &&
			String(noteField?.readLimit).includes('top-level') &&
			String(noteField?.writeLimit).includes('cannot write'),
		'a note property says what can be read and that it cannot be written',
	);
}

/*
 * A link stores the path it was given, and moving the table it points at leaves that
 * path stale. The app still reads the table by its file name, so everything this
 * server reports and writes through a link has to resolve the same way — otherwise a
 * cell shows its value while the column is described as unconfigured, a relation
 * loses its row labels, and writing a row by name fails. Its table has a name of its
 * own on purpose: a file name two tables share resolves to neither.
 */
mkdirSync(join(vault, 'stale', '深'), { recursive: true });
const staleRun = await drive([
	call(1, 'create_table', { path: 'stale/远端.layer', name: '远端' }),
	call(2, 'add_field', { path: 'stale/远端.layer', name: '名称', type: 'text' }),
	call(3, 'add_field', { path: 'stale/远端.layer', name: '金额', type: 'number' }),
	call(4, 'add_records', { path: 'stale/远端.layer', records: [{ 名称: '甲', 金额: '2' }] }),
	call(5, 'create_table', { path: 'stale/主表.layer', name: '主表' }),
	call(6, 'add_field', { path: 'stale/主表.layer', name: '标题', type: 'text' }),
	call(7, 'add_field', {
		path: 'stale/主表.layer',
		name: '条目',
		type: 'relation',
		targetTable: 'stale/远端.layer',
		linkField: '名称',
	}),
	call(8, 'add_records', {
		path: 'stale/主表.layer',
		records: [{ 标题: '订单一', 条目: ['甲'] }],
	}),
	call(9, 'add_field', {
		path: 'stale/主表.layer',
		name: '查找金额',
		type: 'lookup',
		lookupSource: '条目',
		lookupField: '金额',
	}),
]).catch((error) => stop(error.message));
const staleById = new Map(staleRun.messages.map((message) => [message.id, message]));
check(
	[1, 2, 3, 4, 5, 6, 7, 8, 9].every((id) => staleById.get(id)?.result?.isError !== true),
	'the stale-link fixture was built',
);

renameSync(join(vault, 'stale', '远端.layer'), join(vault, 'stale', '深', '远端.layer'));

const staleRead = await drive([
	call(1, 'read_table', { path: 'stale/主表.layer' }),
]).catch((error) => stop(error.message));
const staleText = staleRead.messages[0]?.result?.content?.[0]?.text ?? '';
let staleDoc = null;
try {
	staleDoc = JSON.parse(staleText);
} catch (error) {
	failures.push(`the stale-link read did not return JSON: ${String(error)}`);
}
let staleRecordId = '';
if (staleDoc !== null) {
	const cells = staleDoc.records?.[0]?.cells ?? {};
	check(cells['查找金额'] === '2', `a lookup reads through a stale link: ${cells['查找金额']}`);
	const lookupField = (staleDoc.fields ?? []).find((field) => field.name === '查找金额');
	check(
		lookupField?.computedFrom?.table === 'stale/深/远端.layer' &&
			lookupField?.computedFrom?.column === '金额' &&
			lookupField?.computedFrom?.tableName === '远端',
		`a lookup names the table it really reads: ${JSON.stringify(lookupField?.computedFrom)}`,
	);
	const relationField = (staleDoc.fields ?? []).find((field) => field.name === '条目');
	check(
		relationField?.computedFrom?.column === '名称' &&
			relationField?.config?.shows === '名称' &&
			relationField?.config?.targetTable === 'stale/深/远端.layer',
		`a relation names the column it shows: ${JSON.stringify(relationField?.config)}`,
	);
	staleRecordId = staleDoc.records?.[0]?.id ?? '';
	const label = (staleDoc.rowLabels ?? {})[
		Array.isArray(cells['条目']) ? cells['条目'][0] : ''
	];
	check(label === '甲', `a relation still labels its row: ${label}`);
}

const staleWrite = await drive([
	call(1, 'update_cells', {
		path: 'stale/主表.layer',
		updates: [{ recordId: staleRecordId, field: '条目', value: ['甲'] }],
	}),
	call(2, 'update_field', {
		path: 'stale/主表.layer',
		field: '查找金额',
		lookupField: '名称',
	}),
]).catch((error) => stop(error.message));
check(
	staleWrite.messages[0]?.result?.isError !== true,
	`a relation is written by row name through a stale link: ${staleWrite.messages[0]?.result?.content?.[0]?.text?.slice(0, 160) ?? ''}`,
);
check(
	staleWrite.messages[1]?.result?.isError !== true,
	`a lookup column is re-pointed through a stale link: ${staleWrite.messages[1]?.result?.content?.[0]?.text?.slice(0, 160) ?? ''}`,
);

let staleFile = null;
try {
	staleFile = JSON.parse(readFileSync(join(vault, 'stale', '主表.layer'), 'utf8'));
} catch (error) {
	failures.push(`the stale-link table could not be read back: ${String(error)}`);
}
const storedLink = (staleFile?.fields ?? []).find((field) => field.name === '条目');
check(
	storedLink?.linkPath === 'stale/远端.layer',
	'a resolved link is read, not rewritten on disk',
);

rmSync(vault, { recursive: true, force: true });

if (err.trim() !== '') {
	console.log(`server stderr:\n${err.trim()}`);
}

if (failures.length > 0) {
	for (const failure of failures) {
		console.error(`mcp smoke: ${failure}`);
	}
	process.exit(1);
}

console.log(`mcp smoke: ${toolNames.length} tools, files written and reread, all checks passed`);
