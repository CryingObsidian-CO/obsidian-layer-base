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
