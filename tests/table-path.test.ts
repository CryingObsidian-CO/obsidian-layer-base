import { describe, expect, it } from 'vitest';
import { pickTablePath, tableBasename } from '../src/model/table-path';

function vaultOf(...paths: string[]) {
	const set = new Set(paths);
	return {
		tables: paths,
		isTable: (path: string) => set.has(path),
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
		expect(pickTablePath('a/项目表.layer', vault.tables, vault.isTable)).toBe(
			'a/项目表.layer',
		);
	});

	it('finds the table again by name after a move', () => {
		const vault = vaultOf('归档/项目表.layer');
		expect(pickTablePath('项目/项目表.layer', vault.tables, vault.isTable)).toBe(
			'归档/项目表.layer',
		);
	});

	it('finds it after the folder itself was renamed', () => {
		const vault = vaultOf('新目录/任务.layer');
		expect(pickTablePath('旧目录/任务.layer', vault.tables, vault.isTable)).toBe(
			'新目录/任务.layer',
		);
	});

	it('gives up when the file was renamed, since no name matches', () => {
		const vault = vaultOf('项目/新名字.layer');
		expect(pickTablePath('项目/旧名字.layer', vault.tables, vault.isTable)).toBeNull();
	});

	it('refuses to choose between two tables with the same name', () => {
		const vault = vaultOf('a/任务.layer', 'b/任务.layer');
		expect(pickTablePath('c/任务.layer', vault.tables, vault.isTable)).toBeNull();
	});

	it('answers nothing when there are no tables at all', () => {
		expect(pickTablePath('x.layer', [], () => false)).toBeNull();
	});

	it('compares names exactly, not by prefix or case', () => {
		const vault = vaultOf('a/任务表.layer');
		expect(pickTablePath('a/任务.layer', vault.tables, vault.isTable)).toBeNull();
	});

	it('does not take a file that is not a table for the table', () => {
		const tables = ['归档/表B.layer'];
		const isTable = (path: string) => tables.includes(path);
		expect(pickTablePath('项目/表B.md', tables, isTable)).toBe('归档/表B.layer');
	});

	it('trusts a path that is a table even before the listing has caught up', () => {
		// The table list is cached, so a table made a moment ago can be missing from it while the file is readable.
		expect(pickTablePath('a/刚刚建.layer', [], () => true)).toBe('a/刚刚建.layer');
	});
});
