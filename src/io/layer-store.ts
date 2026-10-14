import { TFile, TFolder, normalizePath, type App } from 'obsidian';
import { LAYER_EXTENSION } from '../constants';
import type { SeedLabels } from './schema';
import { createEmptyDoc, parseLayerDoc, serializeLayerDoc } from './schema';

/**
 * Creating and reading `.layer` files.
 *
 * Note what is deliberately *not* here: a `save`/`write` method. Once a file is
 * open, `TextFileView` owns its content — `getViewData()` supplies the text and
 * `requestSave()` asks Obsidian to persist it. That keeps writes on Obsidian's
 * own pipeline, so save ordering, Sync conflict handling and file history keep
 * working, and this plugin never races the app for the same file.
 *
 * What lives here is everything that does *not* involve an open view: creating
 * files, choosing a free name, and parsing text off disk.
 */

export interface LoadedLayer {
	doc: ReturnType<typeof parseLayerDoc>['doc'];
	warnings: string[];
}

/** Upper bound on name attempts, so a pathological vault cannot spin forever. */
const MAX_NAME_ATTEMPTS = 50;

export class LayerStore {
	constructor(private readonly app: App) {}

	/**
	 * Creates a new board in `folder` (or the vault root when null) and returns
	 * the file. The caller decides whether to open it.
	 */
	async createBoard(
		folder: TFolder | null,
		baseName: string,
		seed: SeedLabels,
	): Promise<TFile> {
		const base = baseName.trim() || seed.untitledBoard;
		const taken = this.takenNamesIn(folder);
		let name = base;

		for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
			if (attempt > 1) {
				name = `${base} ${attempt}`;
			}

			const path = folder
				? normalizePath(`${folder.path}/${name}.${LAYER_EXTENSION}`)
				: normalizePath(`${name}.${LAYER_EXTENSION}`);

			try {
				await this.app.vault.create(
					path,
					serializeLayerDoc(createEmptyDoc(name, seed)),
				);
			} catch (error) {
				// A name collision is an expected outcome, not a failure: the
				// pre-check and this write can be separated in time by another
				// window creating the same file.
				taken.add(name);
				console.warn(
					`[obsidian-layer-base] "${path}" is unavailable, trying the next name:`,
					error,
				);
				continue;
			}

			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile) {
				return file;
			}
			throw new Error(`Created file could not be retrieved: ${path}`);
		}

		throw new Error(
			`Could not find an unused name after ${MAX_NAME_ATTEMPTS} attempts`,
		);
	}

	/** Reads and parses a file without opening a view for it. */
	async load(file: TFile): Promise<LoadedLayer> {
		const text = await this.app.vault.cachedRead(file);
		return parseLayerDoc(text);
	}

	/**
	 * Base names already used by `.layer` files directly inside one folder.
	 *
	 * Only the target folder is scanned: a collision elsewhere in the vault
	 * cannot make `vault.create` fail, because the path already disambiguates.
	 */
	private takenNamesIn(folder: TFolder | null): Set<string> {
		const target = folder ?? this.app.vault.getRoot();
		const taken = new Set<string>();
		for (const child of target.children) {
			if (child instanceof TFile && child.extension === LAYER_EXTENSION) {
				taken.add(child.basename);
			}
		}
		return taken;
	}
}

/** True when the file is one this plugin can open. */
export function isLayerFile(file: unknown): file is TFile {
	return file instanceof TFile && file.extension === LAYER_EXTENSION;
}