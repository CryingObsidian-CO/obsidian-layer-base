# Working on Layer Base

This is a small plugin with one maintainer, so the process is deliberately light —
but it does have two long-lived branches, and one rule that keeps them honest.

## Branches

```
master   ──●──────────────●──────────▶   what has been released
             \            /
              \          /  one merge per release
develop  ──●───●──●──●──●──▶             what is being written
              \
               ●──●  feature/something   (for a change worth a second look)
```

| Branch | Holds | Tag? |
| --- | --- | --- |
| `master` | Exactly what has been released | Yes — releases are tagged here |
| `develop` | Work in progress | Never |
| `feature/*` | One change, merged into `develop` | Never |

Work goes to `develop`. Open a branch only for changes worth reviewing on their own:
a new file-format field, a changed MCP tool signature, a rewrite of the model layer.
Everything else can be committed straight to `develop`.

## The one rule

**`master` has to be contained in `develop`.** After a release, merge `master` back
into `develop`. If you forget, CI says so on the next push to `develop` instead of
letting the branches drift until they conflict.

## What CI checks

Every branch and every pull request runs the same gates, each as its own step:

| Check | Command |
| --- | --- |
| Types | `npx tsc -noEmit -skipLibCheck` |
| Lint | `npm run lint` |
| Translations | `npm run check:i18n` |
| Styles | `npm run verify:css` |
| Version files agree | `npm run check:version` |
| Unit tests | `npm test` |
| Build | `npm run build` |
| MCP server smoke test | `npm run test:mcp` |

`npm run verify` runs the checks up to and including the unit tests, which is what to
run before pushing.

The MCP smoke test drives `mcp-server.cjs` over stdin against a temporary vault and
checks the files it leaves behind — the server has no unit tests because what matters
is what it writes.

## Releasing

1. On `develop`: set the version in `package.json`, then
   `npm_package_version=<version> node version-bump.mjs` to update `manifest.json`
   and `versions.json`. Commit.
2. Merge `develop` into `master`.
3. Tag that commit with the version, and **no leading `v`**: `git tag 0.1.0`.
4. `git push origin master --tags`.

The release workflow runs the tests again, builds, checks that the tag matches
`manifest.json`, and creates a **draft** release with four files attached:

```
main.js  manifest.json  styles.css  mcp-server.cjs
```

Check the draft, then publish it by hand. Nothing is published automatically.

If the tag is not on `master`, or does not match the manifest version, the workflow
stops before creating anything.

## Fixing a released version

Fix on `master`, bump the patch version there, tag it, then merge `master` back into
`develop` — the same rule as above, for the same reason.

## Strings

Every user-facing string lives in `src/i18n` and must appear exactly once per locale
(`en`, `zh`, `zh-TW`). `npm run check:i18n` fails on a missing or duplicated key, and
the types make a missing key a compile error in the code that asks for it.

Developer-facing output — console messages, parser warnings — stays in English so
bug reports and stack traces line up.

## Commits

Plain sentences describing what changed and why. No strict format is enforced; the
subject line is what shows up in generated release notes, so make it readable.
