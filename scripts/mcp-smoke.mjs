import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

function drive(calls) {
	return new Promise((resolve, reject) => {
		const server = spawn(process.execPath, ['mcp-server.cjs'], {
			env: { ...process.env, LAYER_VAULT: vault },
			stdio: ['pipe', 'pipe', 'pipe'],
		});

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
		server.on('error', reject);
		server.on('close', () => {
			const messages = out
				.trim()
				.split('\n')
				.filter((line) => line !== '')
				.map((line) => JSON.parse(line));
			resolve({ messages, err });
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
	call(9, 'update_view', { path: 'nested/新表.layer', view: 'Table', sorts: [{ field: '标题', order: 'desc' }] }),
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
]);

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
check(
	textOf(24).includes('unreadable') && textOf(24).includes('tellUser'),
	'read_table says which column it cannot read, and what to tell the reader',
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

/* Clearing a cell needs a row id, so it runs once the first pass has read one. */
const firstRow = JSON.parse(textOf(24)).records[0]?.id ?? '';
const cleared = await drive([
	call(1, 'update_cells', {
		path: 'probe/选项.layer',
		updates: [{ recordId: firstRow, field: '数量', value: '' }],
	}),
]);
const clearedText = cleared.messages[0]?.result?.content?.[0]?.text ?? '';
check(cleared.messages[0]?.result?.isError !== true, 'update_cells accepts the row id');
check(clearedText.includes('"updated": 1'), 'an empty string clears a cell');

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
}

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
