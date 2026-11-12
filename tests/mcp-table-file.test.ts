import { afterEach, describe, expect, it } from 'vitest';
import {
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileText, readFileText, writeFileText } from '../mcp/table-file';

/** A temporary folder for one case, removed after it. */
const folders: string[] = [];
function tempFolder(): string {
	const folder = mkdtempSync(join(tmpdir(), 'layer-base-table-file-'));
	folders.push(folder);
	return folder;
}

afterEach(() => {
	for (const folder of folders.splice(0)) {
		rmSync(folder, { recursive: true, force: true });
	}
});

describe('reading a table file', () => {
	it('returns the exact text on disk', () => {
		const folder = tempFolder();
		const file = join(folder, 'board.layer');
		writeFileSync(file, '{"hello":"world"}', 'utf8');
		expect(readFileText(file)).toBe('{"hello":"world"}');
	});
});

describe('writing a table file', () => {
	it('replaces the file when it still holds the text that was read', () => {
		const folder = tempFolder();
		const file = join(folder, 'board.layer');
		writeFileSync(file, 'old', 'utf8');
		const expected = readFileText(file);
		writeFileText(file, 'new', expected);
		expect(readFileText(file)).toBe('new');
	});

	it('refuses when another writer changed the file after the read', () => {
		const folder = tempFolder();
		const file = join(folder, 'board.layer');
		writeFileSync(file, 'the version this caller read', 'utf8');
		const expected = readFileText(file);
		writeFileSync(file, 'someone else wrote this', 'utf8');
		expect(() => writeFileText(file, 'mine', expected)).toThrow(
			/changed on disk after this call read it/,
		);
		expect(readFileText(file)).toBe('someone else wrote this');
	});

	it('leaves no temporary file behind', () => {
		const folder = tempFolder();
		const file = join(folder, 'board.layer');
		writeFileSync(file, 'old', 'utf8');
		writeFileText(file, 'new', readFileText(file));
		expect(readdirSync(folder)).toEqual(['board.layer']);
	});
});

describe('creating a table file', () => {
	it('writes a file that was not there', () => {
		const folder = tempFolder();
		const file = join(folder, 'new.layer');
		createFileText(file, 'content');
		expect(readFileText(file)).toBe('content');
	});

	it('refuses an existing path instead of overwriting it', () => {
		const folder = tempFolder();
		const file = join(folder, 'existing.layer');
		writeFileSync(file, 'already here', 'utf8');
		expect(() => createFileText(file, 'new content')).toThrow();
		expect(readFileText(file)).toBe('already here');
	});
});
