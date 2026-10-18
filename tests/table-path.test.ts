import { describe, expect, it } from 'vitest';
import { pickTablePath, tableBasename } from '../src/model/table-path';

/** A vault of table paths, answering existence the way the vault would. */
function vaultOf(...paths: string[]) {
	const set = new Set(paths);
	return {
		tables: paths,
		exists: (path: string) => set.has(path),
	};
}

describe('tableBasename', () => {
	it('drops the folder and the extension', () => {
		expect(tableBasename('项目/项目表.layer')).toBe('项目表');
		expect(tableBasename('任务.layer')).toBe('任务');
	});

	it('keeps a name that has no extension', () => {
		expect(tableBasename('a/b/board')).toBe('board');
	});
});

describe('pickTablePath', () => {
	it('uses the stored path when it still exists', () => {
		const vault = vaultOf('a/项目表.layer');
		expect(pickTablePath('a/项目表.layer', vault.tables, vault.exists)).toBe(
			'a/项目表.layer',
		);
	});

	it('finds the table again by name after a move', () => {
		const vault = vaultOf('归档/项目表.layer');
		expect(pickTablePath('项目/项目表.layer', vault.tables, vault.exists)).toBe(
			'归档/项目表.layer',
		);
	});

	it('finds it after the folder itself was renamed', () => {
		const vault = vaultOf('新目录/任务.layer');
		expect(pickTablePath('旧目录/任务.layer', vault.tables, vault.exists)).toBe(
			'新目录/任务.layer',
		);
	});

	it('gives up when the file was renamed, since no name matches', () => {
		const vault = vaultOf('项目/新名字.layer');
		expect(pickTablePath('项目/旧名字.layer', vault.tables, vault.exists)).toBeNull();
	});

	it('refuses to choose between two tables with the same name', () => {
		// Guessing here would point the link at the wrong table silently.
		const vault = vaultOf('a/任务.layer', 'b/任务.layer');
		expect(pickTablePath('c/任务.layer', vault.tables, vault.exists)).toBeNull();
	});

	it('answers nothing when there are no tables at all', () => {
		expect(pickTablePath('x.layer', [], () => false)).toBeNull();
	});

	it('compares names exactly, not by prefix or case', () => {
		const vault = vaultOf('a/任务表.layer');
		expect(pickTablePath('a/任务.layer', vault.tables, vault.exists)).toBeNull();
	});
});
