import { getLanguage } from 'obsidian';
import type { SeedLabels } from '../io/schema';

/**
 * User-facing strings, keyed so a translation can be added without touching
 * call sites.
 *
 * Scope note: this is deliberately a single-file catalogue rather than a full
 * i18n framework. Obsidian renders plugin UI through its own CSS variables, but
 * string data still has to be chosen somewhere; keeping it in one typed map
 * makes the later step (adding `locales/zh.ts` and a lookup) mechanical instead
 * of a find-and-replace across every module.
 */

/** The locale Obsidian is running in, e.g. `zh`, `zh-TW`, `en`. */
export type Locale = 'zh' | 'zh-TW' | 'en';

const en = {
	ribbonNewBoard: 'New board',
	commandCreateFile: 'Create a new board file',
	noticeCreated: (name: string) => `Created board: ${name}`,
	noticeCreateFailed: 'Could not create the board.',
	noticeFolderMissing: (path: string) => `Folder not found: ${path}`,
	noticeParseWarnings: (count: number) =>
		`Repaired ${count} issue(s) while reading this board. See the developer console for details.`,
	settingFolderName: 'Default folder for new boards',
	settingFolderDesc: 'Leave empty to create in the vault root.',
	settingFileNameName: 'Default file name',
	settingFileNameDesc: 'A number is appended when the name is taken.',
	placeholderBoard: 'Untitled board',
	summaryLine: (fields: number, records: number, views: number) =>
		`${fields} fields · ${records} records · ${views} views`,
	emptyFile: 'Empty file',
	seedTitleField: 'Title',
	seedStatusField: 'Status',
	seedTodo: 'To do',
	seedInProgress: 'In progress',
	seedDone: 'Done',
	seedGridView: 'Table',
	seedKanbanView: 'Board',
} as const;

const zh = {
	ribbonNewBoard: '新建多维看板',
	commandCreateFile: '新建多维看板文件',
	noticeCreated: (name: string) => `已创建多维看板：${name}`,
	noticeCreateFailed: '创建多维看板失败。',
	noticeFolderMissing: (path: string) => `找不到目录：${path}`,
	noticeParseWarnings: (count: number) =>
		`读取看板时修正了 ${count} 处问题，详情见开发者控制台。`,
	settingFolderName: '新建文件的默认目录',
	settingFolderDesc: '留空则创建在仓库根目录。',
	settingFileNameName: '新建文件的默认名称',
	settingFileNameDesc: '重名时会自动追加序号。',
	placeholderBoard: '多维看板',
	summaryLine: (fields: number, records: number, views: number) =>
		`${fields} 个字段 · ${records} 条记录 · ${views} 个视图`,
	emptyFile: '空文件',
	seedTitleField: '标题',
	seedStatusField: '状态',
	seedTodo: '待办',
	seedInProgress: '进行中',
	seedDone: '已完成',
	seedGridView: '表格',
	seedKanbanView: '看板',
} as const;

const zhTW = {
	ribbonNewBoard: '新建多維看板',
	commandCreateFile: '新建多維看板檔案',
	noticeCreated: (name: string) => `已建立多維看板：${name}`,
	noticeCreateFailed: '建立多維看板失敗。',
	noticeFolderMissing: (path: string) => `找不到目錄：${path}`,
	noticeParseWarnings: (count: number) =>
		`讀取看板時修正了 ${count} 處問題，詳情請見開發者主控台。`,
	settingFolderName: '新建檔案的預設目錄',
	settingFolderDesc: '留空則建立在儲存庫根目錄。',
	settingFileNameName: '新建檔案的預設名稱',
	settingFileNameDesc: '重名時會自動附加序號。',
	placeholderBoard: '多維看板',
	summaryLine: (fields: number, records: number, views: number) =>
		`${fields} 個欄位 · ${records} 筆記錄 · ${views} 個檢視`,
	emptyFile: '空檔案',
	seedTitleField: '標題',
	seedStatusField: '狀態',
	seedTodo: '待辦',
	seedInProgress: '進行中',
	seedDone: '已完成',
	seedGridView: '表格',
	seedKanbanView: '看板',
} as const;

/**
 * Shape every catalogue must satisfy.
 *
 * `en` is declared `as const`, so its properties carry literal types like
 * `"New board"`. Translations are different strings and would not be assignable
 * to those literals, so primitives are widened back to `string` while function
 * signatures are kept intact.
 */
type Widen<T> = {
	-readonly [K in keyof T]: T[K] extends string
		? string
		: T[K] extends (...args: infer A) => infer R
			? (...args: A) => R
			: T[K];
};

export type Strings = Widen<typeof en>;

const catalogues: Record<Locale, Strings> = { en, zh, 'zh-TW': zhTW };

/**
 * Picks the closest catalogue for the running app.
 *
 * Obsidian reports `zh-CN` for Simplified Chinese and `zh` for Traditional in
 * some builds, so the region suffix is checked rather than matched exactly.
 */
function resolveLocale(): Locale {
	let raw = 'en';
	try {
		raw = getLanguage();
	} catch {
		// getLanguage() exists since 1.8.7; older apps fall back to English.
		return 'en';
	}
	const lang = raw.toLowerCase();
	if (lang === 'zh' || lang.startsWith('zh-cn') || lang.startsWith('zh-hans')) {
		return 'zh';
	}
	if (lang.startsWith('zh')) {
		return 'zh-TW';
	}
	return 'en';
}

let active: Strings = catalogues[resolveLocale()];

/**
 * Default field, option and view names for a newly created board.
 *
 * These differ from UI strings in one important way: they are written into the
 * user's `.layer` file once and then belong to the user, who can rename them
 * freely. They are seeded in the app language at creation time and are not
 * retranslated afterwards.
 */
export function seedLabels(): SeedLabels {
	return {
		untitledBoard: active.placeholderBoard,
		titleField: active.seedTitleField,
		statusField: active.seedStatusField,
		todoOption: active.seedTodo,
		inProgressOption: active.seedInProgress,
		doneOption: active.seedDone,
		gridView: active.seedGridView,
		kanbanView: active.seedKanbanView,
	};
}

/** Current catalogue for the app language. */
export function t(): Strings {
	return active;
}

/** Re-reads the app language. Call when a settings change may alter it. */
export function refreshLocale(): void {
	active = catalogues[resolveLocale()];
}
