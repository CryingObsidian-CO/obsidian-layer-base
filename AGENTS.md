# Working in this repository

**English** | [简体中文](docs/AGENTS.zh.md)

`layer-base` is an Obsidian community plugin. `src/` is TypeScript bundled by esbuild into
`main.js`, which Obsidian loads. `mcp/` is a standalone MCP server bundled into
`mcp-server.cjs` and started as a plain Node process by a client: it shares the model code
but none of Obsidian's API. A `.layer` file is one self-contained JSON document — fields,
records and views — that the plugin draws as a table or as boards.

`README.md` is for users. `CONTRIBUTING.md` owns the branches, the release steps and the
full gate table; `docs/` holds the screenshots and the Chinese copies of the process
documents. This file is only what an agent gets wrong without being told.

## Ask, do not invent

When a requirement is unclear, ask. A rule invented to fill the gap reads exactly like a
rule that was agreed, and the difference only surfaces once something has been built on it.

## Do not

- Commit `main.js` or `mcp-server.cjs`. They are build output, and `npm run dev` writes a
  development build into the same path the release build uses.
- Hand-edit a version. Four carriers must agree — `manifest.json`, `package.json`,
  `versions.json`, and the announcement in `mcp/server.ts` — and `npm run check:version` is
  the judge. `npm version` runs `version-bump.mjs`, which writes all four.
- Rename what other people's setups depend on: the plugin id `layer-base`, the `_format`
  marker in `src/io/schema.ts`, a command id, a setting key, an MCP tool name, or a label
  already visible in the interface.
- Add a user-facing string anywhere but `src/i18n`. There are three locales (`en`, `zh`,
  `zh-TW`) and `npm run check:i18n` fails on a missing or duplicated key.
- Write a comment that talks to yourself, restates the line below it, or records a
  reminder. Comments explain the code to the next reader, in English, only where the
  reason is not obvious from the code.
- Reinstate `:has()` in `styles.css` or `keyCode` in `src/`. Both were removed on purpose:
  `:has()` makes the browser re-match every modal container on each redraw, and `keyCode`
  is deprecated in favour of `isComposing` and the `Process` key.

## Before saying a change is done

`npm run verify` runs types, lint, translations, styles, the version check and the unit
tests. `npm run test:mcp` drives the built server over stdin against a temporary vault, so
it needs `npm run build:mcp` first. CI runs the same gates as separate steps; the build
only runs for a pull request or a push to `master`.

## Where a change belongs

| Directory    | Holds                                                                                |
|--------------|--------------------------------------------------------------------------------------|
| `src/model/` | Pure logic: records, fields, formulas, filters, sorts, rollups. No DOM, no Obsidian. |
| `src/io/`    | Reading and writing `.layer`: parsing, repair, migration.                            |
| `src/views/` | The table and the boards: drawing, selection, drag, undo wiring.                     |
| `src/ui/`    | Modals, popovers, dropdowns, cell editors.                                           |
| `tests/`     | Vitest, one file beside the model code it exercises.                                 |

## Data safety

Three places where a small mistake loses data silently: the save path, undo, and note
properties written through `noteProp` fields. A change that touches one of them needs a way
to show the old behaviour still holds, not only that the new one looks right.

Adding a field type or a view type is a file-format change. A build older than the new type
reads an unknown view as a table view and saves it back that way, so decide whether
`LAYER_FORMAT_VERSION` goes up: a bump makes older builds refuse to write the file instead
of quietly flattening it.

The MCP server names Node built-ins in exactly one module, `mcp/node-api.ts`. Keep them
there, or a checker without Node's type declarations reports every call as an unsafe value.
