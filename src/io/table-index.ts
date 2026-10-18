import { TFile, type App, type Plugin } from 'obsidian';
import { pickTablePath } from '../model/table-path';
import type { LayerDoc } from '../types';
import { isLayerFile } from './layer-store';
import { parseLayerDoc } from './schema';

/**
 * The tables this vault holds, and the parsed copy of the ones something points
 * at.
 *
 * Reads are async but a cell has to paint now, so a document is answered from
 * the cache when it is there and `ensure` is what fills it in; the caller is told
 * when a read lands so it can paint again. Entries are dropped whenever the file
 * behind them changes, so a stale table is never shown as the current one.
 */
export class TableIndex {
	private readonly cache = new Map<string, LayerDoc>();
	private readonly loading = new Set<string>();
	/** Tables whose read failed; not asked for again until the vault changes. */
	private readonly unavailable = new Set<string>();
	private readonly listeners = new Set<() => void>();
	private readonly renameListeners = new Set<
		(oldPath: string, newPath: string) => void
	>();
	/** The vault's tables, rebuilt after anything in the vault changes. */
	private tableList: string[] | null = null;
	/**
	 * Stored path to the path it really reads, once worked out.
	 *
	 * Kept because the answer is asked for once per cell on every paint, and
	 * working it out means listing the vault.
	 */
	private readonly resolvedPaths = new Map<string, string>();

	constructor(private readonly app: App) {}

	/** Every `.layer` file in the vault, as paths. */
	listTables(): string[] {
		this.tableList ??= this.app.vault
			.getFiles()
			.filter(isLayerFile)
			.map((file) => file.path)
			.sort((a, b) => a.localeCompare(b));
		return this.tableList;
	}

	/** The cached document for a path, or null while it has not been read. */
	get(path: string): LayerDoc | null {
		return this.cache.get(path) ?? null;
	}

	/**
	 * The path a stored link should actually read.
	 *
	 * A rename leaves the stored path pointing at nothing; `pickTablePath` is what
	 * falls back to the filename, and the answer is remembered until the vault
	 * changes again.
	 */
	resolve(storedPath: string): string | null {
		const known = this.resolvedPaths.get(storedPath);
		if (known !== undefined) {
			return known === '' ? null : known;
		}
		const actual = pickTablePath(storedPath, this.listTables(), (path) =>
			this.app.vault.getAbstractFileByPath(path) !== null,
		);
		// A miss is remembered as an empty string, so a broken link does not send
		// every paint back through the vault listing.
		this.resolvedPaths.set(storedPath, actual ?? '');
		return actual;
	}

	/**
	 * Reads a table once, then tells the listeners.
	 *
	 * Safe to call while painting: a cached path, a finished load and one already
	 * in flight all return immediately, so a render cannot start a second read.
	 */
	ensure(path: string, onLoaded?: () => void): void {
		if (this.cache.has(path)) {
			onLoaded?.();
			return;
		}
		if (this.loading.has(path) || this.unavailable.has(path)) {
			return;
		}
		const file = this.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile) || !isLayerFile(file)) {
			return;
		}
		this.loading.add(path);
		void this.app.vault
			.cachedRead(file)
			.then((text) => parseLayerDoc(text).doc)
			.then((doc) => {
				this.cache.set(path, doc);
			})
			.catch((error: unknown) => {
				/*
				 * Remembered, not retried. A read that keeps failing would otherwise
				 * be asked for again on every paint, and every failure asks for a
				 * repaint — a loop that never settles and leaves the board unusable.
				 */
				this.unavailable.add(path);
				console.warn(
					`[obsidian-layer-base] Could not read the linked table "${path}":`,
					error,
				);
			})
			.finally(() => {
				this.loading.delete(path);
				onLoaded?.();
				this.emit();
			});
	}

	/** Drops a cached table, so the next paint reads it again. */
	forget(path: string): void {
		// A file that changed or came back is worth trying again.
		this.unavailable.delete(path);
		if (this.cache.delete(path)) {
			this.emit();
		}
	}

	/** Told whenever a cached table is replaced or dropped. */
	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** Follows the vault, so a cached table never outlives the file on disk. */
	register(plugin: Plugin): void {
		/*
		 * A table's contents changing only matters when that table is cached, so
		 * this one is quiet otherwise — otherwise every autosave of any board would
		 * repaint every open board.
		 */
		plugin.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile && isLayerFile(file)) {
					if (this.cache.delete(file.path)) {
						this.emit();
					}
				}
			}),
		);

		/*
		 * These change which tables exist or where they live, so every answer
		 * worked out from the listing is void — and the repaint is unconditional:
		 * a link may now resolve (or stop resolving) without any document having
		 * been cached, which is exactly the case a cached document cannot report.
		 */
		const structural = (file: unknown, oldPath?: string): void => {
			this.forgetResolutions();
			if (file instanceof TFile && isLayerFile(file)) {
				this.cache.delete(file.path);
			}
			if (oldPath !== undefined) {
				this.cache.delete(oldPath);
			}
			this.emit();
		};

		plugin.registerEvent(this.app.vault.on('create', (file) => structural(file)));
		plugin.registerEvent(this.app.vault.on('delete', (file) => structural(file)));
		plugin.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				// Repaired before the repaint, so the repaint already sees the new
				// path rather than falling back to its filename.
				for (const listener of this.renameListeners) {
					listener(oldPath, file.path);
				}
				structural(file, oldPath);
			}),
		);
	}

	/** Told when a table is renamed or moved, with where it went. */
	onRename(listener: (oldPath: string, newPath: string) => void): () => void {
		this.renameListeners.add(listener);
		return () => {
			this.renameListeners.delete(listener);
		};
	}

	/** Drops what was worked out from the vault listing, so it is worked out again. */
	private forgetResolutions(): void {
		this.tableList = null;
		this.resolvedPaths.clear();
		this.unavailable.clear();
	}

	private emit(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}
}
