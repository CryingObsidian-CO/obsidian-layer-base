<!-- English or 中文 are both fine — 用中文写也可以。 -->

## What this changes / 改了什么

<!-- One or two sentences. If it fixes an issue, write "Closes #12". -->
<!-- 一两句话说明。修了某个 issue 就写 "Closes #12"。 -->

## Checks / 自查

- [ ] `npm run verify` passes locally — lint, translations, styles, version, tests.
      本地 `npm run verify` 通过：lint、多语言、样式、版本、测试。
- [ ] Every new user-facing string is in all three locales (`src/i18n`), and
      `npm run check:i18n` agrees.
      所有新增的用户可见文案都写进了三种语言（`src/i18n`），并且 `npm run check:i18n` 通过。
- [ ] Nothing generated is committed — `main.js` and `mcp-server.cjs` stay untracked.
      没有提交生成物——`main.js` 和 `mcp-server.cjs` 保持未跟踪。

## Worth a second look / 需要多看一眼

- [ ] This changes the `.layer` file format or its meaning.
      这部分改动了 `.layer` 的文件格式或含义。
      <!-- If so: does it need a LAYER_FORMAT_VERSION bump, and can old files still open? -->
      <!-- 若是：需要升 LAYER_FORMAT_VERSION 吗？旧文件还能打开吗？ -->
- [ ] This changes a command id, a setting key, or an MCP tool signature.
      这部分改动了命令 id、设置键或 MCP 工具签名。
      <!-- These are what other people's setups and scripts depend on. -->
      <!-- 这些是别人的配置和脚本所依赖的东西。 -->
- [ ] This touches the save path, undo, or note properties.
      这部分动到了保存路径、撤销或笔记属性。
      <!-- The three places where a small mistake loses data silently. -->
      <!-- 这三处一旦出错，会静默丢数据。 -->

## How it was verified / 怎么验证的

<!-- What you ran, what you clicked, and what you saw. Rendering and interaction
     behaviour is hard to prove from a diff, so say how you know. -->
<!-- 你跑了什么、点了什么、看到了什么。渲染和交互很难从 diff 里看出来，
     所以要说明你是怎么确认的。 -->
