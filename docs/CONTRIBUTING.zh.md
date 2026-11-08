[English](../CONTRIBUTING.md) | **简体中文**

# 参与 Layer Base 的开发

这个插件只有一位维护者，所以这份文档很短。分支只有两条，规则只有一条。

## 分支

```
master   ──●──────────────●──────────▶   已经发布的内容
            \            /
             \          /   每次发版合并一次
develop  ──●───●──●──●──●──▶             正在写的内容
            \
             ●──●  feature/something   （值得单独看一眼的改动）
```

| 分支          | 存放什么              | 打不打 tag？      |
|-------------|-------------------|---------------|
| `master`    | 与已发布版本完全一致        | 打，发布在它上面打 tag |
| `develop`   | 进行中的工作            | 不打            |
| `feature/*` | 单个改动，合入 `develop` | 不打            |

改动进 `develop`。只有值得单独审阅的改动才开分支：新增文件格式字段、改动 MCP 工具签名、
重写模型层。其余的直接提交到 `develop` 即可。

## 唯一那条规则

**`master` 上的提交必须都已经在 `develop` 里。** 每次发版之后，把 `master` 合回 `develop`。忘了的话，
下一次推送到 `develop` 时 CI 会直接说出来，而不是让两条分支一直漂移到冲突。

## CI 检查什么

每项单独一步，失败时能直接看出是哪一项坏了。每条分支和每个 PR 都跑检查；构建只在 PR 和
落到 `master` 的东西上跑。

| 检查                    | 命令                              |
|-----------------------|---------------------------------|
| 类型                    | `npx tsc -noEmit -skipLibCheck` |
| Lint                  | `npm run lint`                  |
| 多语言                   | `npm run check:i18n`            |
| 样式                    | `npm run verify:css`            |
| 版本文件一致                | `npm run check:version`         |
| 单元测试                  | `npm test`                      |
| 构建                    | `npm run build`                 |
| MCP server smoke test | `npm run test:mcp`              |

`npm run verify` 跑到单元测试为止，就是推送前该跑的那一套。

推 develop 时，除了这些检查还会多跑一项：分支流向检查，负责发现「发版了但没合回来」。

MCP server 的 smoke test 用 stdin 驱动 `mcp-server.cjs`，对着一个临时仓库跑，检查它最后留下了哪些文件。
这个 server 没有单元测试，因为真正要紧的是它写出去的东西。

样式检查是拿这份样式表和真实的 Obsidian 构建比对。GitHub 的 runner 上没有 Obsidian，
所以那一步只会报 SKIPPED，只有在装了 Obsidian 的机器上才有意义。

## 发版

1. 在 `develop` 上：改 `package.json` 里的版本号，然后
   `npm_package_version=<version> node version-bump.mjs`，它会把版本号写进承载版本的四个
   地方：`manifest.json`、`versions.json`，以及 `mcp/server.ts` 里的版本声明。提交。
2. 把 `develop` 合入 `master`。
3. 在那个提交上打 tag，**不要带 `v` 前缀**：`git tag 0.1.0`。
4. `git push origin master --tags`。

发版工作流会再跑一遍测试、构建、核对 tag 与 `manifest.json` 是否一致，然后创建一个
**草稿** release，附上五个资产：

```
main.js  manifest.json  styles.css  mcp-server.cjs  layer-base-<tag>.zip
```

那个 zip 是平铺的：`main.js`、`manifest.json`、`styles.css`，没有外层目录，手动安装要的就是这种平铺结构。MCP
server 不在里面，它是从客户端自己的路径启动的，不会被复制进仓库。

检查草稿，然后手动发布。不会有任何东西自动发出去。

如果 tag 不在 `master` 上，或者与 manifest 的版本不一致，工作流会在创建任何东西之前停下。

## 修已发布的版本

在 `master` 上修，在那里升补丁版本号，打 tag，然后把 `master` 合回 `develop`，理由同上。

## 文案

所有用户可见的文案都放在 `src/i18n`，而且必须在每种语言里恰好出现一次（`en`、`zh`、
`zh-TW`）。缺一个键或重复一个键，`npm run check:i18n` 都会失败。类型系统会让「代码里要一个
不存在的键」变成编译错误。

面向开发者的输出，比如控制台消息和解析器警告，保持英文，这样 bug 报告和调用栈能对得上。

## 提交

提交信息直接说清改了什么、为什么，不要求格式。标题行会出现在自动生成的发版说明里，
所以要写得让人看得懂。
