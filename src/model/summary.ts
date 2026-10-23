import type { CellValue, Field, LayerRecord } from '../types';
import { formatCell, isDerived } from './fields';
import { dayNumber } from './date';

/**
 * What a column's footer reports.
 *
 * Nothing is totalled unless the reader asks for it: a table that added up every
 * numeric column by itself would put numbers under columns nobody wanted counted,
 * and that choice belongs to whoever is reading the table. The figures come from the
 * rows on screen, so a filtered table totals what is in front of it.
 */

/** The ways a column can be summarised. */
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

/**
 * The choices offered for a column.
 *
 * The counts are always offered because every column can answer them. Adding up is
 * offered only where it means something, and a date is summarised as a span rather
 * than a quantity: two dates added together are not a day.
 */
export function summaryChoicesFor(field: Field): readonly SummaryKind[] {
	const counts: SummaryKind[] = ['none', 'filled', 'empty', 'unique'];
	if (field.type === 'number' || field.type === 'autoNumber') {
		return [...counts, 'sum', 'average', 'min', 'max'];
	}
	if (field.type === 'date' || field.type === 'datetime') {
		return [...counts, 'earliest', 'latest', 'range'];
	}
	return counts;
}

/** Whether a column may be summarised the given way. */
export function canSummarize(field: Field, kind: SummaryKind): boolean {
	return kind === 'none' || summaryChoicesFor(field).includes(kind);
}

/**
 * The text a column's footer shows for the given rows.
 *
 * An empty answer is returned as an empty string rather than as a dash: the footer
 * is a quiet strip, and a column with nothing to report should stay blank.
 */
export function summarize(
	field: Field,
	records: readonly LayerRecord[],
	kind: SummaryKind,
): string {
	if (kind === 'none') {
		return '';
	}

	/*
	 * A computed column stores nothing — its values are worked out by the view, which
	 * is out of reach here. The counts still work, because those ask about the stored
	 * cell rather than about the computed result.
	 */
	const texts: string[] = [];
	for (const record of records) {
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
		/*
		 * How many values appear exactly once — not how many distinct values there are.
		 * `A, A, B` holds one unique value, B, even though it holds two distinct ones.
		 */
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

	const numbers = numericValues(field, records);
	if (numbers.length === 0) {
		return '';
	}
	if (kind === 'sum') {
		return formatCell(field, round(sumOf(numbers)));
	}
	if (kind === 'average') {
		return formatCell(field, round(sumOf(numbers) / numbers.length));
	}
	if (kind === 'min') {
		return formatCell(field, Math.min(...numbers));
	}
	if (kind === 'max') {
		return formatCell(field, Math.max(...numbers));
	}
	return '';
}

/** The numbers a column holds, skipping blanks and anything that is not a number. */
function numericValues(field: Field, records: readonly LayerRecord[]): number[] {
	const numbers: number[] = [];
	for (const record of records) {
		if (isDerived(field.type)) {
			continue;
		}
		const value = record.cells[field.id] ?? '';
		const text = formatCell(field, value).trim();
		if (text === '') {
			continue;
		}
		const number = typeof value === 'number' ? value : Number(text);
		if (Number.isFinite(number)) {
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

/** A number without floating-point noise trailing behind it. */
function round(value: number): number {
	return Number.isInteger(value) ? value : Number(value.toFixed(6));
}
