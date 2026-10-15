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
	emptyFile: 'Empty file',
	seedTitleField: 'Title',
	seedStatusField: 'Status',
	seedTodo: 'To do',
	seedInProgress: 'In progress',
	seedDone: 'Done',
	seedGridView: 'Table',
	seedKanbanView: 'Board',
	gridNoFields: 'This board has no fields yet.',
	gridNoFieldsHint: 'Add a field to start building your table.',
	gridNoRecords: 'No records yet.',
	gridNoRecordsHint: 'Records will appear here once the table has rows.',
	gridNotImplemented: 'This view type is not available yet.',
	cellEmptyOption: 'None',
	cellNoOptions: 'No options defined for this field yet.',
	addRecord: 'New row',
	deleteRecord: 'Delete row',
	selectionRow: (index: number) => `Row ${index} selected`,
	selectionColumn: (name: string) => `Column "${name}" selected`,
	selectionCell: (index: number, name: string) =>
		`Row ${index}, column "${name}"`,
	selectionRange: (rows: number, columns: number) =>
		`${rows} × ${columns} selected`,
	menuCopyCell: 'Copy',
	menuPasteCell: 'Paste',
	menuClearCell: 'Clear',
	menuCellLabel: 'Cell',
	menuRangeLabel: (rows: number, columns: number) =>
		`${rows} × ${columns} cells`,
	menuCopy: 'Copy',
	menuPaste: 'Paste',
	menuFillRange: 'Fill from the first cell',
	menuClearRange: 'Clear',
	menuRowLabel: (index: number) => `Row ${index}`,
	menuColumnLabel: (name: string) => `Column "${name}"`,
	menuInsertRowBelow: 'Insert row below',
	menuInsertRowsBelow: (count: number) => `Insert ${count} rows below`,
	menuDuplicateRow: 'Duplicate row',
	menuDuplicateRows: (count: number) => `Duplicate ${count} rows`,
	menuClearRow: 'Clear all cells',
	menuDeleteRow: 'Delete row',
	menuDeleteRows: (count: number) => `Delete ${count} rows`,
	recordsDeleteConfirm: (count: number) =>
		`Delete ${count} rows? Their values cannot be recovered.`,
	menuEditField: 'Edit column',
	menuDuplicateField: 'Duplicate column',
	menuInsertField: 'Insert column after',
	menuDeleteField: 'Delete column',
	noticeCopied: 'Copied to the clipboard.',
	noticeNothingToPaste: 'Nothing to paste.',
	noticePasteFailed: 'The clipboard does not fit this column’s type.',
	noticePasteTypesMismatch: 'The clipboard’s types do not match these columns.',
	noticePasteNoRoom: 'The clipboard is larger than the space below and to the right.',
	noticePastePartial: (written: number, refused: number) =>
		`Pasted ${written} cell(s); ${refused} did not fit their column.`,
	addField: 'New column',
	fieldNewTitle: 'New field',
	fieldEditTitle: 'Edit field',
	fieldNameLabel: 'Name',
	fieldNamePlaceholder: 'Field name',
	fieldTypeLabel: 'Type',
	fieldPrimaryLabel: 'Use as the record title',
	fieldOptionsLabel: 'Options',
	fieldAddOption: 'Add option',
	fieldOptionPlaceholder: 'Option name',
	fieldRemoveOption: 'Remove option',
	fieldDelete: 'Delete column',
	fieldDeleteConfirm: (name: string, affected: number) =>
		affected === 0
			? `Delete the column "${name}"? It holds no values.`
			: `Delete the column "${name}" and the values in ${affected} row(s)?`,
	fieldConverted: (dropped: number) =>
		`${dropped} value(s) were cleared because the new type cannot hold them.`,
	fieldNameRequired: 'Enter a name for this field.',
	save: 'Save',
	cancel: 'Cancel',
	typeText: 'Text',
	typeSelect: 'Select',
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
	emptyFile: '空文件',
	seedTitleField: '标题',
	seedStatusField: '状态',
	seedTodo: '待办',
	seedInProgress: '进行中',
	seedDone: '已完成',
	seedGridView: '表格',
	seedKanbanView: '看板',
	gridNoFields: '这个看板还没有字段。',
	gridNoFieldsHint: '添加字段后即可开始建表。',
	gridNoRecords: '还没有记录。',
	gridNoRecordsHint: '新建记录后会显示在这里。',
	gridNotImplemented: '该视图类型尚未支持。',
	cellEmptyOption: '无',
	cellNoOptions: '该字段还没有定义选项。',
	addRecord: '新增行',
	deleteRecord: '删除行',
	selectionRow: (index: number) => `已选中第 ${index} 行`,
	selectionColumn: (name: string) => `已选中「${name}」列`,
	selectionCell: (index: number, name: string) =>
		`第 ${index} 行，「${name}」列`,
	selectionRange: (rows: number, columns: number) =>
		`已框选 ${rows} × ${columns}`,
	menuCopyCell: '复制',
	menuPasteCell: '粘贴',
	menuClearCell: '清空',
	menuCellLabel: '单元格',
	menuRangeLabel: (rows: number, columns: number) =>
		`${rows} × ${columns} 个单元格`,
	menuCopy: '复制',
	menuPaste: '粘贴',
	menuFillRange: '向下填充（以首个单元格为准）',
	menuClearRange: '清空',
	menuRowLabel: (index: number) => `第 ${index} 行`,
	menuColumnLabel: (name: string) => `「${name}」列`,
	menuCopyRow: '复制整行',
	menuInsertRowBelow: '在下方插入行',
	menuInsertRowsBelow: (count: number) => `在下方插入 ${count} 行`,
	menuDuplicateRow: '创建副本',
	menuDuplicateRows: (count: number) => `创建 ${count} 行的副本`,
	menuClearRow: '清空整行',
	menuDeleteRow: '删除行',
	menuDeleteRows: (count: number) => `删除 ${count} 行`,
	recordsDeleteConfirm: (count: number) =>
		`将删除 ${count} 行，其中的值无法恢复。`,
	menuEditField: '编辑列',
	menuDuplicateField: '复制列',
	menuInsertField: '在此列后插入',
	menuDeleteField: '删除列',
	noticeCopied: '已复制到剪贴板。',
	noticeNothingToPaste: '剪贴板里没有可粘贴的内容。',
	noticePasteFailed: '剪贴板内容与目标列的类型不匹配。',
	noticePasteTypesMismatch: '剪贴板的类型与目标列不一致。',
	noticePasteNoRoom: '剪贴板内容超出右下方可用范围，无法粘贴。',
	noticePastePartial: (written: number, refused: number) =>
		`已粘贴 ${written} 个单元格；${refused} 个因类型不匹配被跳过。`,
	addField: '新增列',
	fieldNewTitle: '新建字段',
	fieldEditTitle: '编辑字段',
	fieldNameLabel: '名称',
	fieldNamePlaceholder: '字段名称',
	fieldTypeLabel: '类型',
	fieldPrimaryLabel: '用作记录标题',
	fieldOptionsLabel: '选项',
	fieldAddOption: '添加选项',
	fieldOptionPlaceholder: '选项名称',
	fieldRemoveOption: '删除选项',
	fieldDelete: '删除列',
	fieldDeleteConfirm: (name: string, affected: number) =>
		affected === 0
			? `删除「${name}」列？该列没有数据。`
			: `删除「${name}」列及其 ${affected} 行中的值？`,
	fieldConverted: (dropped: number) =>
		`有 ${dropped} 个值因新类型无法容纳而被清空。`,
	fieldNameRequired: '请填写字段名称。',
	save: '保存',
	cancel: '取消',
	typeText: '文本',
	typeSelect: '单选',
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
	emptyFile: '空檔案',
	seedTitleField: '標題',
	seedStatusField: '狀態',
	seedTodo: '待辦',
	seedInProgress: '進行中',
	seedDone: '已完成',
	seedGridView: '表格',
	seedKanbanView: '看板',
	gridNoFields: '這個看板還沒有欄位。',
	gridNoFieldsHint: '新增欄位後即可開始建表。',
	gridNoRecords: '還沒有記錄。',
	gridNoRecordsHint: '新增記錄後會顯示在這裡。',
	gridNotImplemented: '該檢視類型尚未支援。',
	cellEmptyOption: '無',
	cellNoOptions: '該欄位還沒有定義選項。',
	addRecord: '新增行',
	deleteRecord: '刪除列',
	selectionRow: (index: number) => `已選取第 ${index} 列`,
	selectionColumn: (name: string) => `已選取「${name}」欄`,
	selectionCell: (index: number, name: string) =>
		`第 ${index} 列，「${name}」欄`,
	selectionRange: (rows: number, columns: number) =>
		`已框選 ${rows} × ${columns}`,
	menuCopyCell: '複製',
	menuPasteCell: '貼上',
	menuClearCell: '清空',
	menuCellLabel: '儲存格',
	menuRangeLabel: (rows: number, columns: number) =>
		`${rows} × ${columns} 個儲存格`,
	menuCopy: '複製',
	menuPaste: '貼上',
	menuFillRange: '向下填滿（以首個儲存格為準）',
	menuClearRange: '清空',
	menuRowLabel: (index: number) => `第 ${index} 列`,
	menuColumnLabel: (name: string) => `「${name}」欄`,
	menuCopyRow: '複製整列',
	menuInsertRowBelow: '在下方插入列',
	menuInsertRowsBelow: (count: number) => `在下方插入 ${count} 列`,
	menuDuplicateRow: '建立副本',
	menuDuplicateRows: (count: number) => `建立 ${count} 列的副本`,
	menuClearRow: '清空整列',
	menuDeleteRow: '刪除列',
	menuDeleteRows: (count: number) => `刪除 ${count} 列`,
	recordsDeleteConfirm: (count: number) =>
		`將刪除 ${count} 列，其中的值無法復原。`,
	menuEditField: '編輯欄',
	menuDuplicateField: '複製欄',
	menuInsertField: '在此欄後插入',
	menuDeleteField: '刪除欄',
	noticeCopied: '已複製到剪貼簿。',
	noticeNothingToPaste: '剪貼簿裡沒有可貼上的內容。',
	noticePasteFailed: '剪貼簿內容與目標欄的類型不相符。',
	noticePasteTypesMismatch: '剪貼簿的類型與目標欄不一致。',
	noticePasteNoRoom: '剪貼簿內容超出右下方可用範圍，無法貼上。',
	noticePastePartial: (written: number, refused: number) =>
		`已貼上 ${written} 個儲存格；${refused} 個因類型不相符被略過。`,
	addField: '新增欄',
	fieldNewTitle: '新增欄位',
	fieldEditTitle: '編輯欄位',
	fieldNameLabel: '名稱',
	fieldNamePlaceholder: '欄位名稱',
	fieldTypeLabel: '類型',
	fieldPrimaryLabel: '用作記錄標題',
	fieldOptionsLabel: '選項',
	fieldAddOption: '新增選項',
	fieldOptionPlaceholder: '選項名稱',
	fieldRemoveOption: '刪除選項',
	fieldDelete: '刪除欄',
	fieldDeleteConfirm: (name: string, affected: number) =>
		affected === 0
			? `刪除「${name}」欄？該欄沒有資料。`
			: `刪除「${name}」欄及其 ${affected} 列中的值？`,
	fieldConverted: (dropped: number) =>
		`有 ${dropped} 個值因新型別無法容納而被清空。`,
	fieldNameRequired: '請填寫欄位名稱。',
	save: '儲存',
	cancel: '取消',
	typeText: '文字',
	typeSelect: '單選',
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
