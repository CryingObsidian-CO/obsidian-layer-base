import { t } from '../i18n';
import type { FormulaError } from '../model/formula/lexer';
import {
	formulaErrorKey,
	formulaErrorKindKey,
	formulaFunctionKey,
	formulaSymbolKey,
} from '../model/formula/message';

/**
 * Turns a formula error into the sentence a reader sees.
 *
 * This lives beside the UI rather than in the engine because it is the only layer
 * that may reach the locale files: the engine stays pure so it can be tested
 * without an `obsidian` runtime, and it reports a code instead of a sentence.
 */
export function formulaErrorMessage(error: FormulaError): string {
	const { key, detail } = formulaErrorKey(error);
	const catalog = t() as unknown as Record<
		string,
		string | ((value: string) => string) | undefined
	>;
	const entry = catalog[key];
	if (entry === undefined) {
		return t().formulaErrGeneric;
	}
	if (typeof entry === 'function') {
		return entry(detail ?? '');
	}
	return entry;
}

/** The explanation under a function's button, in the reader's language. */
export function formulaFunctionHelp(name: string): string {
	const key = formulaFunctionKey(name);
	if (key === null) {
		return '';
	}
	const catalog = t() as unknown as Record<string, string | undefined>;
	return catalog[key] ?? '';
}

/** The name of a group of functions, in the reader's language. */
export function formulaGroupLabel(key: string): string {
	const catalog = t() as unknown as Record<string, string | undefined>;
	return catalog[key] ?? '';
}

/**
 * The few words a cell shows when a formula failed, in the reader's language.
 *
 * A cell is too narrow for a sentence, and a raw code like `trailing-text` says
 * nothing to whoever is reading the table — so the cell names the KIND of mistake
 * and the sentence travels as a hover.
 */
export function formulaErrorShort(error: FormulaError): string {
	const key = formulaErrorKindKey(error);
	const catalog = t() as unknown as Record<string, string | undefined>;
	return catalog[key] ?? catalog.formulaErrShortSyntax ?? '';
}

/** What a symbol does, in the reader's language, for its button's tooltip. */
export function formulaSymbolHelp(symbol: string): string {
	const key = formulaSymbolKey(symbol);
	if (key === null) {
		return '';
	}
	const catalog = t() as unknown as Record<string, string | undefined>;
	return catalog[key] ?? '';
}