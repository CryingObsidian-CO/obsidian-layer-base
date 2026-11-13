import { t } from '../i18n';
import type { FormulaError } from '../model/formula/lexer';
import {
	formulaErrorKey,
	formulaErrorKindKey,
	formulaFunctionKey,
	formulaSymbolKey,
} from '../model/formula/message';

/** Here rather than in the engine, which reports a code and touches no locale file. */
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

export function formulaFunctionHelp(name: string): string {
	const key = formulaFunctionKey(name);
	if (key === null) {
		return '';
	}
	const catalog = t() as unknown as Record<string, string | undefined>;
	return catalog[key] ?? '';
}

export function formulaGroupLabel(key: string): string {
	const catalog = t() as unknown as Record<string, string | undefined>;
	return catalog[key] ?? '';
}

/** A cell is too narrow for a sentence: it names the kind of mistake, the sentence goes in the hover. */
export function formulaErrorShort(error: FormulaError): string {
	const key = formulaErrorKindKey(error);
	const catalog = t() as unknown as Record<string, string | undefined>;
	return catalog[key] ?? catalog.formulaErrShortSyntax ?? '';
}

export function formulaSymbolHelp(symbol: string): string {
	const key = formulaSymbolKey(symbol);
	if (key === null) {
		return '';
	}
	const catalog = t() as unknown as Record<string, string | undefined>;
	return catalog[key] ?? '';
}