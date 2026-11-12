import type { CellValue, Field, LayerDoc, LayerRecord } from '../types';
import { computeFormulaWithReader, type FormulaValue } from './formula';
import type { FormulaError } from './formula/lexer';
import { aggregateRollup, type RollupValue } from './rollup';
import { numberTexts } from './numbering';
import { emptyValueFor, formatCell, relationIds } from './fields';
import { findRecord } from './records';
import { readsFromView } from './capabilities';
import {
	lookupChips,
	relationBackIndex,
	relationBackRows,
	relationText,
	type BacklinkRow,
	type CellReader as CellTextReader,
} from './relation';

/** What a view needs to draw one cell. */
export interface CellReading {
	text: string;
	broken: number;
	/** Values to draw as separate chips, when the cell holds more than one. */
	chips?: readonly string[];
	/** What kind of value stands behind the text, when the caller knows. */
	kind?: 'number' | 'text' | 'boolean';
	/** Whether a box drawn for this cell is ticked. Only read when `kind` is boolean. */
	ticked?: boolean;
	/** Why the cell cannot show what it should, as a sentence. */
	hint?: string;
}

/**
 * What the reader needs from the layer it lives in.
 *
 * The model may not import Obsidian, so an editor supplies its live table cache
 * and metadata cache, while the MCP server supplies its own file reads. Keeping
 * these three questions here is what lets both answer a cell the same way.
 */
export interface CellReaderHost {
	/**
	 * The table a link points at. `from` is the table the field lives in; an
	 * empty path means that same table.
	 */
	table(field: Field, from: LayerDoc, direction: 'link' | 'back'): LayerDoc | null;
	/** The text of one frontmatter key in the note at `notePath`. */
	noteProperty(notePath: string, key: string): string;
	/** How a formula error reads in the caller's language, for the cell and its hover. */
	formulaError(error: FormulaError): { text: string; hint: string };
}

/** One table's cells, read against the live documents a host can reach. */
export class CellReader {
	private readDepth = 0;
	/** Reverse lookups for the current pass, per source column. */
	private readonly backIndexes = new Map<string, Map<string, string[]> | null>();
	/** The pointing rows themselves, per source column, for the current pass. */
	private readonly backRows = new Map<string, Map<string, BacklinkRow[]> | null>();
	/** Numbering texts for the current pass, per column. */
	private readonly numbers = new Map<string, Map<string, string>>();

	constructor(private readonly host: CellReaderHost) {}

	/** Drops answers tied to one render pass; call before drawing a new one. */
	reset(): void {
		this.readDepth = 0;
		this.backIndexes.clear();
		this.backRows.clear();
		this.numbers.clear();
	}

	/**
	 * Reads a cell the document cannot read by itself.
	 *
	 * A note property lives in another file; a relation stores row ids and the names
	 * are in another table; a computed column stores nothing at all. Answering null
	 * leaves every other type to the plain rules, so this switch is the whole of
	 * "this column needs the layer".
	 */
	reading(doc: LayerDoc, field: Field, record: LayerRecord): CellReading | null {
		if (this.readDepth > 8) {
			return null;
		}
		this.readDepth += 1;
		try {
			return this.readingIn(doc, field, record);
		} finally {
			this.readDepth -= 1;
		}
	}

	private readingIn(doc: LayerDoc, field: Field, record: LayerRecord): CellReading | null {
		switch (field.type) {
			case 'noteProp':
				return this.notePropReading(doc, field, record.id);
			case 'autoNumber':
				return this.autoNumberReading(doc, field, record.id);
			case 'relation':
				return this.relationReading(doc, field, record.cells[field.id] ?? '');
			case 'relationBack':
				return this.backReading(doc, field, record.id);
			case 'formula':
				return this.formulaReading(doc, field, record.id);
			case 'rollup':
				return this.rollupReading(doc, field, record.id);
			case 'lookup':
				return this.lookupReading(doc, field, record.id);
			default:
				// Every stored type is read by the document itself.
				return null;
		}
	}

	/** The text a cell reads as, or null when the document can read it itself. */
	text(doc: LayerDoc, field: Field, record: LayerRecord): string | null {
		return this.reading(doc, field, record)?.text ?? null;
	}

	/** What one cell reads as, whoever is asking; stored types fall back to formatCell. */
	displayText(doc: LayerDoc, field: Field, record: LayerRecord): string {
		const read = this.reading(doc, field, record);
		if (read !== null) {
			return read.text;
		}
		return formatCell(field, record.cells[field.id] ?? emptyValueFor(field));
	}

	/**
	 * How another table's cells read, for the columns that table cannot read itself.
	 *
	 * The same answer this table's cells get, asked of the table they live in. That
	 * is what lets a relation show a formula, a lookup show a rollup and a backlink
	 * title a numbering column — one answer, every table.
	 */
	readerIn(doc: LayerDoc): CellTextReader {
		return (field, record) =>
			this.reading(doc, field, record)?.text ??
			formatCell(field, record.cells[field.id] ?? '');
	}

	/** What a note property row reads. */
	notePropReading(doc: LayerDoc, field: Field, recordId: string): CellReading {
		return { text: this.notePropValueIn(doc, field, recordId), broken: 0 };
	}

	/** The value a note property row reads, resolved through the row's note column. */
	private notePropValueIn(doc: LayerDoc, field: Field, recordId: string): string {
		const record = findRecord(doc, recordId);
		if (!record) {
			return '';
		}
		const source = doc.fields.find((candidate) => candidate.id === field.noteFieldId);
		if (!source || source.type !== 'note') {
			return '';
		}
		const path = record.cells[source.id];
		if (typeof path !== 'string' || path === '') {
			return '';
		}
		const key = field.frontmatterKey ?? field.name;
		return this.host.noteProperty(path, key);
	}

	/**
	 * What a formula row computes to.
	 *
	 * The columns are re-read from the open document rather than trusted from the
	 * cell that asked: the grid was built from an earlier render, and a formula
	 * must read the values as they are now.
	 */
	formulaReading(doc: LayerDoc, field: Field, recordId: string): CellReading {
		const record = findRecord(doc, recordId);
		const target = doc.fields.find((candidate) => candidate.id === field.id);
		if (!record || !target) {
			return { text: '', broken: 0 };
		}
		/*
		 * A column with no expression yet is not an error, it is a column waiting to
		 * be set up, so it reads as empty rather than reporting a failure in every
		 * row of a field that was just created.
		 */
		if ((target.formula ?? '').trim() === '') {
			return { text: '', broken: 0 };
		}
		const result = computeFormulaWithReader(doc, record, target, (other) =>
			this.formulaCellValueIn(doc, other, record, recordId),
		);
		if (result.ok) {
			/*
			 * The text is always what was computed; only the dressing follows the
			 * column's declared kind. Coercing here would quietly change a result
			 * the reader can see, which is worse than presenting it plainly.
			 */
			return {
				text: result.text,
				broken: 0,
				kind: target.formulaType ?? result.kind,
				ticked: result.truthy,
			};
		}
		return { ...this.host.formulaError(result.error), broken: 1 };
	}

	/**
	 * What one column hands a formula.
	 *
	 * Asked only for the columns the document cannot read on its own: a relation
	 * keeps row ids where the grid shows names, and a lookup, rollup, reverse
	 * relation, note property or numbering keeps nothing at all. Every other type
	 * answers `undefined` and is read from its stored cell — which matters, because
	 * a number column must arrive as a number or `+` would join it as text instead
	 * of adding it.
	 */
	formulaCellValueIn(
		doc: LayerDoc,
		field: Field,
		record: LayerRecord,
		recordId: string,
	): FormulaValue | undefined {
		switch (field.type) {
			case 'relation':
				return this.relationReading(doc, field, record.cells[field.id] ?? '').text;
			case 'relationBack':
				return this.backReading(doc, field, recordId).text;
			case 'lookup':
				return this.lookupReading(doc, field, recordId).text;
			case 'autoNumber':
				return this.autoNumberReading(doc, field, recordId).text;
			case 'rollup': {
				const answer = this.rollupAnswerIn(doc, field, record, recordId);
				if (answer === null) {
					return '';
				}
				return answer.kind === 'number' ? Number(answer.text) : answer.text;
			}
			case 'noteProp':
				return this.notePropValueIn(doc, field, recordId);
			default:
				return undefined;
		}
	}

	/**
	 * What a numbering cell reads: its position within its group, padded.
	 *
	 * Counted for the whole column at once and kept for this render pass, because
	 * the count walks every row of the group — asking that per cell would make the
	 * table cost its own square.
	 */
	autoNumberReading(doc: LayerDoc, field: Field, recordId: string): CellReading {
		let texts = this.numbers.get(field.id);
		if (!texts) {
			// The live column, not the copy the paint was handed, so a setting
			// changed since the tree was built cannot be counted with.
			const target = doc.fields.find((other) => other.id === field.id) ?? field;
			texts = numberTexts(doc, target);
			this.numbers.set(field.id, texts);
		}
		return { text: texts.get(recordId) ?? '', broken: 0, kind: 'number' };
	}

	/** What a rollup gathered from the rows this row is linked to. */
	rollupReading(doc: LayerDoc, field: Field, recordId: string): CellReading {
		const record = findRecord(doc, recordId);
		if (!record) {
			return { text: '', broken: 0 };
		}
		const answer = this.rollupAnswerIn(doc, field, record, recordId);
		if (answer === null) {
			return { text: '', broken: 0 };
		}
		return { text: answer.text, broken: 0, kind: answer.kind };
	}

	/**
	 * The total a rollup reached, before it is dressed for the cell.
	 *
	 * Null covers both "this column is not set up" and "the other table cannot be
	 * read": either way the column has nothing to show, and neither is an error.
	 */
	private rollupAnswerIn(
		doc: LayerDoc,
		field: Field,
		record: LayerRecord,
		recordId: string,
	): RollupValue | null {
		const target = doc.fields.find((candidate) => candidate.id === field.id);
		if (!target) {
			return null;
		}
		const sourceField = doc.fields.find(
			(candidate) => candidate.id === target.rollupSourceFieldId,
		);
		// Not configured yet, or pointing at a column that is gone: a column waiting
		// to be set up reads as empty, not as a failure in every row.
		if (!sourceField || !target.rollupFieldId) {
			return null;
		}
		const gathered = this.gatheredValuesIn(
			doc,
			sourceField,
			target.rollupFieldId,
			record,
			recordId,
		);
		if (gathered === null) {
			return null;
		}
		return aggregateRollup(
			gathered.map((entry) => entry.text ?? entry.value),
			target.rollupAggregate ?? 'sum',
		);
	}

	/**
	 * What a lookup read from the rows this row is linked to.
	 *
	 * One chip per value, in the order the link lists the rows. Values that repeat
	 * stay repeated: dropping one would silently forget that a linked row exists.
	 * Nothing about it is stored, so it cannot go stale when the other table moves.
	 */
	lookupReading(doc: LayerDoc, field: Field, recordId: string): CellReading {
		const record = findRecord(doc, recordId);
		const target = doc.fields.find((candidate) => candidate.id === field.id);
		if (!record || !target) {
			return { text: '', broken: 0 };
		}
		const sourceField = doc.fields.find(
			(candidate) => candidate.id === target.lookupSourceFieldId,
		);
		const columnId = target.lookupFieldId ?? '';
		// Not set up yet, or pointing at a column that is gone: an unconfigured
		// column reads as empty, not as a failure in every row.
		if (!sourceField || columnId === '') {
			return { text: '', broken: 0 };
		}
		const other = this.host.table(
			sourceField,
			doc,
			sourceField.type === 'relationBack' ? 'back' : 'link',
		);
		const gathered = this.gatheredValuesIn(
			doc,
			sourceField,
			columnId,
			record,
			recordId,
		);
		if (!other || gathered === null) {
			return { text: '', broken: 0 };
		}
		/*
		 * Read through the formatter of the column the values came from, not
		 * through a link reader: a gathered value is the value itself, while a
		 * link reader expects a cell holding a list of row ids and answers
		 * with nothing for anything else.
		 */
		const column = other.fields.find((candidate) => candidate.id === columnId);
		if (!column) {
			return { text: '', broken: 0 };
		}
		const chips = lookupChips(
			column,
			gathered.map((entry) => entry.value),
			(linked, value) => this.relationReading(other, linked, value).chips ?? [],
			gathered.map((entry) => entry.text),
		);
		return { text: chips.join(', '), broken: 0, chips };
	}

	/**
	 * The values a rollup reduces, or null when the other table cannot be read.
	 *
	 * Null is not the same as an empty list: an empty list means the other table was
	 * read and had nothing to contribute, which a count answers as zero.
	 */
	private gatheredValuesIn(
		doc: LayerDoc,
		sourceField: Field,
		columnId: string,
		record: LayerRecord,
		recordId: string,
	): readonly { value: CellValue; text: string | null }[] | null {
		if (sourceField.type === 'relation') {
			const other = this.host.table(sourceField, doc, 'link');
			if (!other) {
				return null;
			}
			return relationIds(record.cells[sourceField.id] ?? '').map((id) =>
				this.gatheredIn(other, columnId, findRecord(other, id)),
			);
		}

		if (sourceField.type === 'relationBack') {
			const other = this.host.table(sourceField, doc, 'back');
			if (!other) {
				return null;
			}
			const key = `${sourceField.id}\u0000${sourceField.backFieldId ?? ''}`;
			let rows = this.backRows.get(key);
			if (rows === undefined) {
				rows = relationBackRows(other, sourceField.backFieldId ?? '');
				this.backRows.set(key, rows);
			}
			if (rows === null) {
				return null;
			}
			return (rows.get(recordId) ?? []).map((row) =>
				this.gatheredIn(other, columnId, row.record),
			);
		}

		// A source column that is neither kind is a configuration this column cannot
		// answer, so it reads as empty rather than guessing at a direction.
		return null;
	}

	/**
	 * One gathered value, plus the text to use when that column computes it.
	 *
	 * `text` is null for every column that stores what it shows, so the caller reads
	 * the stored value — a number column has to stay a number or a total stops being
	 * arithmetic. A computed column has nothing stored, so what its cell reads as is
	 * all there is; without this, a lookup or rollup over a formula gathered blanks.
	 */
	private gatheredIn(
		doc: LayerDoc,
		columnId: string,
		record: LayerRecord | undefined,
	): { value: CellValue; text: string | null } {
		if (!record) {
			return { value: '', text: null };
		}
		const stored = record.cells[columnId] ?? '';
		const column = doc.fields.find((candidate) => candidate.id === columnId);
		if (!column || !readsFromView(column.type)) {
			return { value: stored, text: null };
		}
		return {
			value: stored,
			text: this.reading(doc, column, record)?.text ?? '',
		};
	}

	/** What a relation cell shows. */
	relationReading(doc: LayerDoc, field: Field, value: CellValue): CellReading {
		const target = this.host.table(field, doc, 'link');
		if (!target) {
			return { text: '', broken: relationIds(value).length };
		}
		const resolved = relationText(
			target,
			field.linkFieldId ?? '',
			value,
			this.readerIn(target),
		);
		return {
			text: resolved.texts.join(', '),
			broken: resolved.broken,
			chips: resolved.texts,
		};
	}

	/** What a reverse relation row shows: the rows elsewhere that point at it. */
	backReading(doc: LayerDoc, field: Field, recordId: string): CellReading {
		const source = this.host.table(field, doc, 'back');
		if (source === null) {
			return { text: '', broken: 1 };
		}
		/*
		 * Built once per column per render, not once per cell: asking per cell
		 * would scan the whole source table for every row of this one.
		 */
		const titleFieldId = field.backTitleFieldId ?? '';
		const key = `${field.backPath ?? ''}\u0000${field.backFieldId ?? ''}\u0000${titleFieldId}`;
		let index = this.backIndexes.get(key);
		if (index === undefined) {
			index = relationBackIndex(
				source,
				field.backFieldId ?? '',
				titleFieldId,
				this.readerIn(source),
			);
			this.backIndexes.set(key, index);
		}
		if (index === null) {
			return { text: '', broken: 1 };
		}
		const texts = index.get(recordId) ?? [];
		return {
			text: texts.join(', '),
			broken: 0,
			chips: texts,
		};
	}
}
