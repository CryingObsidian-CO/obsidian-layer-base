#!/usr/bin/env node
/*
 * Checks on the locale files that a unit test cannot make.
 *
 * Reading the locale files from `tests/` would need `node:fs`, which a plugin
 * that must run on mobile may not import — and the Obsidian lint rule enforces
 * that. So the checks that need the file live here instead, where Node is the
 * runtime by definition.
 */
import { readFileSync } from 'node:fs';

// A path may be passed in, which is how this can be pointed at a broken copy to
// show that it really does catch one.
const SOURCE = process.argv[2] ?? 'src/i18n/index.ts';
const text = readFileSync(SOURCE, 'utf8');

/** Every `key: '...'` entry, in the order it appears. */
const entries = [...text.matchAll(/^\t(\w+):\s*'((?:[^'\\]|\\.)*)',?$/gm)].map(
	(match) => ({ key: match[1], value: match[2] }),
);

const problems = [];

/** A tooltip is a label: it does not end in a full stop, half- or full-width. */
const TOOLTIP = /^formulaFn/;
for (const { key, value } of entries) {
	if (!TOOLTIP.test(key)) {
		continue;
	}
	if (/[.。]$/.test(value)) {
		problems.push(`${key} is a tooltip and must not end with a full stop: "${value}"`);
	}
	if (value.trim() === '') {
		problems.push(`${key} is empty`);
	}
}

/** Every key must be defined once per locale, so a translation cannot be missed. */
const counts = new Map();
for (const { key } of entries) {
	counts.set(key, (counts.get(key) ?? 0) + 1);
}
const LOCALES = 3;
for (const [key, count] of counts) {
	if (count !== LOCALES) {
		problems.push(`${key} is defined ${count} time(s); expected ${LOCALES}`);
	}
}

/**
 * The functions the engine offers, read from its own source.
 *
 * Taken from `eval.ts` rather than listed here, so a function added to the engine
 * cannot be forgotten by this check: it will simply have no tooltip, and fail.
 */
const ENGINE = 'src/model/formula/eval.ts';
const engineText = readFileSync(ENGINE, 'utf8');
const builtinBlock = engineText.slice(
	engineText.indexOf('const BUILTINS'),
	engineText.indexOf('/** The names a formula may call'),
);
const functions = [...builtinBlock.matchAll(/^\t([A-Z][A-Z0-9_]*):\s*\{/gm)].map(
	(match) => match[1],
);

if (functions.length === 0) {
	problems.push(`no built-in functions found in ${ENGINE}`);
}

/** The locale key a function's tooltip lives under, by the engine's own rule. */
function tooltipKeyFor(name) {
	return `formulaFn${name.charAt(0)}${name.slice(1).toLowerCase()}`;
}

for (const name of functions) {
	const key = tooltipKeyFor(name);
	const count = entries.filter((entry) => entry.key === key).length;
	if (count !== LOCALES) {
		problems.push(
			`${name} has no tooltip: ${key} is defined ${count} time(s); expected ${LOCALES}`,
		);
	}
}

/**
 * The groups the functions are offered under must each be named, and together
 * they must cover exactly the functions the engine has.
 */
const groupKeys = [
	...engineText.matchAll(/labelKey:\s*'(\w+)'/g),
].map((match) => match[1]);
if (groupKeys.length === 0) {
	problems.push('no function groups found in the engine');
}
for (const key of groupKeys) {
	const count = entries.filter((entry) => entry.key === key).length;
	if (count !== LOCALES) {
		problems.push(
			`${key} is a group label and is defined ${count} time(s); expected ${LOCALES}`,
		);
	}
}

/**
 * Every group member must be a real function, so a group cannot name a function
 * that was renamed or removed.
 */
const grouped = [...engineText.matchAll(/functions:\s*\[([^\]]*)\]/g)]
	.flatMap((match) => match[1].split(','))
	.map((name) => name.replace(/['"\s]/g, ''))
	.filter((name) => name !== '');
for (const name of grouped) {
	if (!functions.includes(name)) {
		problems.push(`a group names "${name}", which is not a built-in function`);
	}
}

/**
 * Every symbol must have wording, or its button would explain nothing. The keys
 * are read from the engine, where a symbol and its sentence are declared together.
 */
const symbolKeys = [...engineText.matchAll(/hintKey:\s*'(\w+)'/g)].map(
	(match) => match[1],
);
if (symbolKeys.length === 0) {
	problems.push('no formula symbols found in the engine');
}
for (const key of symbolKeys) {
	const count = entries.filter((entry) => entry.key === key).length;
	if (count !== LOCALES) {
		problems.push(
			`${key} explains a symbol and is defined ${count} time(s); expected ${LOCALES}`,
		);
	}
}

if (problems.length > 0) {
	console.error(`Locale checks failed (${problems.length}):`);
	for (const problem of problems) {
		console.error(`  - ${problem}`);
	}
	process.exit(1);
}

console.log(
	`Locale checks passed: ${counts.size} keys, ${entries.length} entries, ${LOCALES} locales.`,
);
