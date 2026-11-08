# Working on Layer Base

**English** | [简体中文](docs/CONTRIBUTING.zh.md)

This plugin has one maintainer, so this page is short. Two long-lived branches, one rule.

## Branches

```
master   ──●──────────────●──────────▶   what has been released
            \            /
             \          /  one merge per release
develop  ──●───●──●──●──●──▶             what is being written
            \
             ●──●  feature/something   (for a change worth a second look)
```

| Branch      | Holds                             | Tag?                          |
|-------------|-----------------------------------|-------------------------------|
| `master`    | Exactly what has been released    | Yes, releases are tagged here |
| `develop`   | Work in progress                  | Never                         |
| `feature/*` | One change, merged into `develop` | Never                         |

Work goes to `develop`. Open a branch only for changes worth reviewing on their own:
a new file-format field, a changed MCP tool signature, a rewrite of the model layer.
Everything else can be committed straight to `develop`.

## The one rule

**Every commit on `master` has to be in `develop`.** After a release, merge `master` back
into `develop`. If you forget, CI says so on the next push to `develop` instead of
letting the branches drift until they conflict.

## What CI checks

Each gate is its own step, so a failure names the thing that broke. Every branch and every
pull request runs the checks; the build is held back to a pull request and to anything
landing on `master`.

| Check                 | Command                         |
|-----------------------|---------------------------------|
| Types                 | `npx tsc -noEmit -skipLibCheck` |
| Lint                  | `npm run lint`                  |
| Translations          | `npm run check:i18n`            |
| Styles                | `npm run verify:css`            |
| Version files agree   | `npm run check:version`         |
| Unit tests            | `npm test`                      |
| Build                 | `npm run build`                 |
| MCP server smoke test | `npm run test:mcp`              |

`npm run verify` runs the checks up to and including the unit tests, which is what to
run before pushing.

A push to `develop` runs those checks and one more, the branch-flow check, which is what
notices a release that was never merged back.

The MCP server smoke test drives `mcp-server.cjs` over stdin against a temporary vault and
checks the files it leaves behind. The server has no unit tests, because what matters is
what it writes.

The styles check compares the stylesheet against a real Obsidian build. A GitHub runner has
none, so it reports SKIPPED there and only means something on a machine with Obsidian
installed.

## Releasing

1. On `develop`: set the version in `package.json`, then
   `npm_package_version=<version> node version-bump.mjs`, which writes that version into
   all four places that carry one: `manifest.json`, `versions.json`, and the announcement
   in `mcp/server.ts`. Commit.
2. Merge `develop` into `master`.
3. Tag that commit with the version, and **no leading `v`**: `git tag 0.1.0`.
4. `git push origin master --tags`.

The release workflow runs the tests again, builds, checks that the tag matches
`manifest.json`, and creates a **draft** release with five assets attached:

```
main.js  manifest.json  styles.css  mcp-server.cjs  layer-base-<tag>.zip
```

The zip is flat: `main.js`, `manifest.json` and `styles.css`, no wrapping folder. That is
the layout a manual install wants. The MCP server is not in it, because it is run from
a client's own path rather than copied into a vault.

Check the draft, then publish it by hand. Nothing is published automatically.

If the tag is not on `master`, or does not match the manifest version, the workflow
stops before creating anything.

## Fixing a released version

Fix on `master`, bump the patch version there, tag it, then merge `master` back into
`develop`. Same reason as above.

## Strings

Every user-facing string lives in `src/i18n` and must appear exactly once per locale
(`en`, `zh`, `zh-TW`). `npm run check:i18n` fails on a missing or duplicated key, and
the types make a missing key a compile error in the code that asks for it.

Developer-facing output, such as console messages and parser warnings, stays in English so
bug reports and stack traces line up.

## Commits

Say what changed and why. No format is required. The subject line is what shows up in
generated release notes, so write a subject people can read.
