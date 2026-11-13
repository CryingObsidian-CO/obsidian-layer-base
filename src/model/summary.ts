import type { CellValue, Field, LayerRecord } from '../types';
import { capabilityOf } from './capabilities';
import { formatCell, isDerived } from './fields';
import { dayNumber } from './date';
import { parseShownNumber } from './number';

/**
 * Nothing is totalled unless the reader asks for it; the figures come from the rows on
 * screen, so a filtered table totals what is in front of it.
 */

export type SummaryKind =
	| 'none'
	| 'filled'
	| 'empty'
	| 'unique'
	| 'sum'
	| 'average'
	| 'min'
	| 'max'
	| 'earliest'
	| 'latest'
	| 'range';

export function summaryChoicesFor(field: Field): readonly SummaryKind[] {
	return capabilityOf(field.type).summaries;
}

export function canSummarize(field: Field, kind: SummaryKind): boolean {
	return kind === 'none' || summaryChoicesFor(field).includes(kind);
}

/** An empty answer is a blank footer, not a dash. */
export function summarize(
	field: Field,
	records: readonly LayerRecord[],
	kind: SummaryKind,
	textOf?: (record: LayerRecord) => string,
): string {
	if (kind === 'none') {
		return '';
	}

	/*
	 * A computed column stores nothing; with `textOf` the total is about what is on screen,
	 * without one the stored cell counts as empty.
	 */
	const texts: string[] = [];
	for (const record of records) {
		if (textOf) {
			texts.push(textOf(record).trim());
			continue;
		}
		const value: CellValue = record.cells[field.id] ?? '';
		texts.push(isDerived(field.type) ? '' : formatCell(field, value).trim());
	}
	const filled = texts.filter((text) => text !== '');

	if (kind === 'filled') {
		return String(filled.length);
	}
	if (kind === 'empty') {
		return String(texts.length - filled.length);
	}
	if (kind === 'unique') {
		// How many values appear exactly once, not how many distinct ones: `A, A, B` holds one unique value, B.
		const seen = new Map<string, number>();
		for (const text of filled) {
			seen.set(text, (seen.get(text) ?? 0) + 1);
		}
		let once = 0;
		for (const count of seen.values()) {
			if (count === 1) {
				once += 1;
			}
		}
		return String(once);
	}

	if (field.type === 'date' || field.type === 'datetime') {
		const days = filled
			.map((text) => ({ text, day: dayNumber(text) }))
			.filter((entry): entry is { text: string; day: number } => entry.day !== null);
		if (days.length === 0) {
			return '';
		}
		const earliest = days.reduce((a, b) => (b.day < a.day ? b : a));
		const latest = days.reduce((a, b) => (b.day > a.day ? b : a));
		if (kind === 'earliest') {
			return earliest.text;
		}
		if (kind === 'latest') {
			return latest.text;
		}
		// The range collapses to a single date when every row shares one.
		return earliest.day === latest.day
			? earliest.text
			: `${earliest.text} – ${latest.text}`;
	}

	const numbers = numericValues(field, records, textOf);
	if (numbers.length === 0) {
		return '';
	}
	if (kind === 'sum') {
		return figureOf(field, round(sumOf(numbers)));
	}
	if (kind === 'average') {
		return figureOf(field, round(sumOf(numbers) / numbers.length));
	}
	if (kind === 'min') {
		return figureOf(field, Math.min(...numbers));
	}
	if (kind === 'max') {
		return figureOf(field, Math.max(...numbers));
	}
	return '';
}

/**
 * A total is written in the column's own terms; an auto-numbered column has no cell to format,
 * and a total is not a serial, so it is not padded.
 */
function figureOf(field: Field, value: number): string {
	return field.type === 'autoNumber' ? String(value) : formatCell(field, value);
}

function numericValues(
	field: Field,
	records: readonly LayerRecord[],
	textOf?: (record: LayerRecord) => string,
): number[] {
	const numbers: number[] = [];
	for (const record of records) {
		const value: CellValue = record.cells[field.id] ?? '';
		/* A stored number is the value itself; its display text may be rounded, and a per cent
		 * column's text carries a `%` that parses as no number at all. */
		if (typeof value === 'number' && Number.isFinite(value)) {
			numbers.push(value);
			continue;
		}
		// Nothing stored to read: a computed column's value arrives as the text the view draws.
		let text = '';
		if (textOf) {
			text = textOf(record).trim();
		} else if (!isDerived(field.type)) {
			text = formatCell(field, value).trim();
		}
		if (text === '') {
			// Blank is not zero: an empty cell contributes nothing to a total.
			continue;
		}
		const number = parseShownNumber(text);
		if (number !== null) {
			numbers.push(number);
		}
	}
	return numbers;
}

function sumOf(numbers: readonly number[]): number {
	let total = 0;
	for (const number of numbers) {
		total += number;
	}
	return total;
}

function round(value: number): number {
	return Number.isInteger(value) ? value : Number(value.toFixed(6));
}
