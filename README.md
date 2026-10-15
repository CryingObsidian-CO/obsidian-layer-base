# Layer Base

Multi-dimensional boards for Obsidian. A `.layer` file is a self-contained
database — field definitions, records and several views — that renders as a
table or a board without depending on your vault's folder structure.

## Status

Milestone 0. Table and board views are not implemented yet; a `.layer` file
currently opens with a summary and its raw JSON so the file format can be
verified end to end.

## Languages

The interface follows the Obsidian app language and ships with English,
Simplified Chinese and Traditional Chinese. User-facing strings live in one
typed catalogue (`src/i18n`), so adding a language means adding an object and
registering it in `resolveLocale` — no changes at the call sites.

Developer-facing output (console messages, parser warnings) stays in English on
purpose, so bug reports and stack traces line up.

Note that `getLanguage()` requires Obsidian 1.8.7, which is what `minAppVersion`
is set to.

## File format

```jsonc
{
  "version": 1,
  "name": "项目看板",
  "fields": [
    { "id": "f_a", "name": "标题", "type": "text", "primary": true },
    { "id": "f_b", "name": "状态", "type": "select",
      "options": [{ "id": "o_1", "name": "待办", "color": "default" }] }
  ],
  "records": [
    { "id": "r_1", "created": 1730000000000,
      "cells": { "f_a": "写方案", "f_b": "o_1" } }
  ],
  "views": [
    { "id": "v_1", "name": "表格", "type": "grid" },
    { "id": "v_2", "name": "看板", "type": "kanban", "groupByFieldId": "f_b" }
  ]
}
```

Two rules keep the data safe across edits:

- `cells` is keyed by **field id**, so renaming a column never orphans values.
- `select` cells store **option ids**, so renaming or recolouring an option
  never orphans values.

The file is plain JSON on disk, so it stays readable, diffable and editable by
hand, and works with Obsidian Sync and file history.

## Development

```bash
npm install
npm run dev     # watch build to main.js
npm run build   # type check + production build
npm run lint
```

To try it in a vault, copy `main.js`, `manifest.json` and `styles.css` into
`<Vault>/.obsidian/plugins/obsidian-layer-base/`, then enable the plugin under
**Settings → Community plugins**.

## Privacy

No network requests and no telemetry. The plugin reads and writes only the
`.layer` files you open.

## References

- [Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin)
- [API documentation](https://docs.obsidian.md)