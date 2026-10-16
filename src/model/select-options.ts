import type { Field, SelectOption } from '../types';
import { generateId } from '../utils/id';

/** A colour an option can wear: the name stored in the file, and its hex. */
interface PaletteColor {
	readonly name: string;
	readonly hex: string;
}

/*
 * The single table behind every colour decision in this module: the name written
 * into `SelectOption.color`, the theme variable that name resolves to, and the
 * canonical hex for places that need a literal value (a native colour input,
 * for instance). Keeping the three side by side is what stops the name -> var
 * and name -> hex mappings from drifting apart.
 *
 * The names are Obsidian's own accent names, so pills follow the active theme
 * rather than pinning hues of their own.
 */
const OPTION_COLORS: readonly PaletteColor[] = [
	{ name: 'blue', hex: '#086ddd' },
	{ name: 'green', hex: '#08b94e' },
	{ name: 'orange', hex: '#ec7500' },
	{ name: 'purple', hex: '#7852ee' },
	{ name: 'red', hex: '#e93147' },
	{ name: 'cyan', hex: '#00bfbc' },
	{ name: 'yellow', hex: '#e0ac00' },
	{ name: 'pink', hex: '#d53984' },
];

/** The names a new option cycles through, in the order they are handed out. */
export const OPTION_PALETTE: readonly string[] = OPTION_COLORS.map(
	(color) => color.name,
);

/** Used when a stored colour cannot be resolved: visible, but clearly neutral. */
const FALLBACK_HEX = '#888888';

const SHORT_HEX = /^#[0-9a-f]{3}$/i;
const LONG_HEX = /^#[0-9a-f]{6}$/i;
const THEME_VAR = /^var\(\s*--color-([a-z0-9-]+)\s*\)$/i;

/** `'default'` and blanks mean "no colour of its own", so both count as unset. */
function isUnset(value: string): boolean {
	return value === '' || value.toLowerCase() === 'default';
}

/** The palette entry for a name, ignoring case. */
function paletteColor(value: string): PaletteColor | undefined {
	const name = value.toLowerCase();
	return OPTION_COLORS.find((entry) => entry.name === name);
}

/** The palette entry behind `var(--color-name)`, when that name is one of ours. */
function themeColor(value: string): PaletteColor | undefined {
	const match: RegExpExecArray | null = THEME_VAR.exec(value.trim());
	const name = match?.[1];
	return name ? paletteColor(name) : undefined;
}

/**
 * The CSS colour for an option, or `null` when it has none we can resolve.
 * Palette names become theme variables; `var(...)` references and hex literals
 * are handed back as written, so a value set by hand keeps working.
 */
export function optionCssColor(color: string | undefined): string | null {
	const value = color?.trim() ?? '';
	if (isUnset(value)) {
		return null;
	}
	const palette = paletteColor(value);
	if (palette) {
		return `var(--color-${palette.name})`;
	}
	if (THEME_VAR.test(value) || SHORT_HEX.test(value) || LONG_HEX.test(value)) {
		return value;
	}
	return null;
}

/**
 * The canonical hex for an option, for places that need a literal colour rather
 * than a variable. Anything unresolvable becomes grey, so a bad value still
 * leaves a visible pill instead of throwing or painting nothing.
 */
export function optionColorHex(color: string | undefined): string {
	const value = color?.trim() ?? '';
	const palette = paletteColor(value) ?? themeColor(value);
	if (palette) {
		return palette.hex;
	}
	if (SHORT_HEX.test(value)) {
		const expanded = value
			.slice(1)
			.toLowerCase()
			.split('')
			.map((digit) => digit + digit)
			.join('');
		return `#${expanded}`;
	}
	if (LONG_HEX.test(value)) {
		return value.toLowerCase();
	}
	return FALLBACK_HEX;
}

/** The colour to give the next option: the palette, stepped by how many exist. */
export function nextOptionColor(
	options: readonly SelectOption[] | undefined,
): string {
	const used = options?.length ?? 0;
	return OPTION_PALETTE[used % OPTION_PALETTE.length] ?? 'blue';
}

/** A field's option by name, ignoring case and surrounding spaces. */
export function findOptionByName(
	field: Field,
	name: string,
): SelectOption | undefined {
	const wanted = name.trim().toLowerCase();
	if (!wanted) {
		return undefined;
	}
	return field.options?.find(
		(option) => option.name.trim().toLowerCase() === wanted,
	);
}

/** The options matching a search query, in the order they were stored. Blank keeps them all. */
export function filterOptions(
	options: readonly SelectOption[] | undefined,
	query: string,
): SelectOption[] {
	const all = options ? [...options] : [];
	const needle = query.trim().toLowerCase();
	return needle
		? all.filter((option) => option.name.toLowerCase().includes(needle))
		: all;
}

/** The name a typed query would create: trimmed, or `''` when there is none. */
export function normaliseOptionName(query: string): string {
	return query.trim();
}

/** Appends a new option, creating the list and choosing the next colour. */
export function appendOption(field: Field, name: string): SelectOption {
	field.options ??= [];
	const option: SelectOption = {
		id: generateId('o'),
		name,
		color: nextOptionColor(field.options),
	};
	field.options.push(option);
	return option;
}
