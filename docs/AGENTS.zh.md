[English](../AGENTS.md) | **简体中文**

# 在这个仓库里工作

`layer-base` 是一个 Obsidian 社区插件。`src/` 里的 TypeScript 由 esbuild 打包成 `main.js`，
Obsidian 加载它。`mcp/` 是一个独立的 MCP server，打包成 `mcp-server.cjs`，由客户端当作普通
Node 进程启动：它共用模型层代码，但不碰 Obsidian 的任何 API。`.layer` 文件是一份自包含的
JSON 文档——字段、记录和视图——插件把它画成表格或看板。

`README.md` 面向用户。`CONTRIBUTING.md` 负责分支、发版步骤和完整的门禁表；`docs/` 放截图和
流程文档的中文版。本文件只写那些不告诉就会做错的事。

## 不确定就问，不要造

需求不清楚的时候，问。为了填空白而造出来的规则，读起来和商量过的一模一样，差别只有在有人
在它上面继续建东西之后才会露出来。

## 不要做

- 不要提交 `main.js` 或 `mcp-server.cjs`。它们是构建产物，而 `npm run dev` 会把开发版写进与
  正式版相同的路径。
- 不要手改版本号。四个载体必须一致——`manifest.json`、`package.json`、`versions.json`，以及
  `mcp/server.ts` 里的版本声明——裁判是 `npm run check:version`。`npm version` 会调用
  `version-bump.mjs`，四处的版本号由它一次写完。
- 不要改名那些别人的配置依赖的东西：插件 id `layer-base`、`src/io/schema.ts` 里的 `_format`
  标记、命令 id、设置键、MCP 工具名，或者界面上已经可见的文案。
- 用户可见的文案只能写在 `src/i18n`。一共三种语言（`en`、`zh`、`zh-TW`），缺键或重复键
  `npm run check:i18n` 会失败。
- 不要写对着自己说话的注释、复述下一行代码的注释、或者备忘式的注释。注释是写给下一个读代码
  的人的，用英文，只在代码本身看不出理由的地方写。
- 不要把 `:has()` 写回 `styles.css`，也不要把 `keyCode` 写回 `src/`。两者都是有理由删掉的：
  `:has()` 会让浏览器每次重绘都重新匹配文档里所有弹窗容器，`keyCode` 已被废弃，改用
  `isComposing` 和 `Process` 键。

## 说「改好了」之前

`npm run verify` 跑类型、lint、多语言、样式、版本检查和单元测试。`npm run test:mcp` 用 stdin
驱动已构建的 server、对着临时仓库跑，所以它需要先 `npm run build:mcp`。CI 把同一套门禁拆成
独立的步骤；构建那个 job 只在 PR 和推送到 `master` 时跑。

## 改动该落在哪

| 目录           | 放什么                                       |
|--------------|-------------------------------------------|
| `src/model/` | 纯逻辑：记录、字段、公式、筛选、排序、汇总。不碰 DOM，不碰 Obsidian。 |
| `src/io/`    | 读写 `.layer`：解析、修复、迁移。                     |
| `src/views/` | 表格和看板：绘制、选择、拖拽、撤销的接线。                     |
| `src/ui/`    | 弹窗、浮层、下拉、单元格编辑器。                          |
| `tests/`     | Vitest，与被测的模型代码一一对应。                      |

## 数据安全

有三个地方，一个小错误会静默丢数据：保存路径、撤销、以及通过 `noteProp` 字段写出的笔记属性。
动到其中任何一个的改动，都要有办法说明旧行为仍然成立，而不只是新行为看起来对。

新增字段类型或视图类型属于文件格式变更。比新类型更旧的构建会把不认识的视图读成表格视图，并
照这样存回去，所以要决定 `LAYER_FORMAT_VERSION` 是否要升：升了之后，旧构建会拒绝写这个文件，
而不是悄悄把它压平成表格。

MCP server 只在 `mcp/node-api.ts` 这一个模块里点名 Node 内置模块。让它们就待在那里，否则一个
没有加载 Node 类型声明的检查器会把每一次调用都报成 unsafe 值。
