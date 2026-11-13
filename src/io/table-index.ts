import { TFile, type App, type Plugin } from 'obsidian';
import { pickTablePath } from '../model/table-path';
import type { LayerDoc } from '../types';
import { isLayerFile } from './layer-store';
import { parseLayerDoc } from './schema';

/** Vault tables, with parsed copies cached for whoever points at them. A read whose file changed
 * mid-flight is dropped rather than stored. */
export class TableIndex {
	private readonly cache = new Map<string, LayerDoc>();
	private readonly loading = new Set<string>();
	/** Tables whose read failed; not asked for again until the vault changes. */
	private readonly unavailable = new Set<string>();
	private readonly listeners = new Set<() => void>();
	private readonly renameListeners = new Set<
		(oldPath: string, newPath: string) => void
	>();
	private tableList: string[] | null = null;
	/** Stored path to the path it really reads, worked out once: the answer is asked for per cell on every paint. */
	private readonly resolvedPaths = new Map<string, string>();
	/** One counter per path, bumped whenever the disk changes. A read carries the number it started
	 * with, so an answer that lands after a change is discarded instead of cached. */
	private readonly versions = new Map<string, number>();

	constructor(private readonly app: App) {}

	listTables(): string[] {
		this.tableList ??= this.app.vault
			.getFiles()
			.filter(isLayerFile)
			.map((file) => file.path)
			.sort((a, b) => a.localeCompare(b));
		return this.tableList;
	}

	get(path: string): LayerDoc | null {
		return this.cache.get(path) ?? null;
	}

	/** The path a stored link should read: a rename leaves the stored path pointing at nothing, so
	 * `pickTablePath` falls back to the filename. Remembered until the vault changes. */
	resolve(storedPath: string): string | null {
		const known = this.resolvedPaths.get(storedPath);
		if (known !== undefined) {
			return known === '' ? null : known;
		}
		const actual = pickTablePath(storedPath, this.listTables(), (path) => {
			// "A table is here", not "something is here": the stored path may name a note or a
			// folder, and taking that as the answer ends the search with a file that cannot be read.
			const file = this.app.vault.getAbstractFileByPath(path);
			return file instanceof TFile && isLayerFile(file);
		});
		// A miss is remembered as an empty string, so a broken link does not list the vault on every paint.
		this.resolvedPaths.set(storedPath, actual ?? '');
		return actual;
	}

	/** Reads a table once, then tells the listeners; safe to call on every paint. */
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
		void this.readInto(file, path, this.versions.get(path) ?? 0, onLoaded);
	}

	private async readInto(
		file: TFile,
		path: string,
		version: number,
		onLoaded?: () => void,
	): Promise<void> {
		try {
			const text = await this.app.vault.cachedRead(file);
			if ((this.versions.get(path) ?? 0) !== version) {
				return;
			}
			this.cache.set(path, parseLayerDoc(text).doc);
		} catch (error: unknown) {
			/*
			 * Remembered, not retried: a read that keeps failing would be asked for again on
			 * every paint, and every failure asks for a repaint — a loop that never settles.
			 */
			this.unavailable.add(path);
			console.warn(
				`[layer-base] Could not read the linked table "${path}":`,
				error,
			);
		} finally {
			this.loading.delete(path);
			onLoaded?.();
			this.emit();
		}
	}

	onChange(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/** Follows the vault, so a cached table never outlives the file on disk. */
	register(plugin: Plugin): void {
		/* A table's contents changing only matters when that table is cached; otherwise every
		 * autosave of any board would repaint every open board. */
		plugin.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile && isLayerFile(file)) {
					/* A file that was unreadable a moment ago may be exactly what has just been
					 * written, so forgetting the failure is what lets the next paint try again. */
					this.invalidate(file.path);
					const wasCached = this.cache.delete(file.path);
					const wasUnavailable = this.unavailable.delete(file.path);
					if (wasCached || wasUnavailable) {
						this.emit();
					}
				}
			}),
		);

		/* These change which tables exist or where they live, so every answer worked out from
		 * the listing is void — and the repaint is unconditional, since a link may now resolve
		 * without any document having been cached. */
		const structural = (file: unknown, oldPath?: string): void => {
			this.forgetResolutions();
			if (file instanceof TFile && isLayerFile(file)) {
				this.invalidate(file.path);
				this.cache.delete(file.path);
			}
			if (oldPath !== undefined) {
				this.invalidate(oldPath);
				this.cache.delete(oldPath);
			}
			this.emit();
		};

		plugin.registerEvent(this.app.vault.on('create', (file) => structural(file)));
		plugin.registerEvent(this.app.vault.on('delete', (file) => structural(file)));
		plugin.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				// Repaired before the repaint, so the repaint already sees the new path.
				for (const listener of this.renameListeners) {
					listener(oldPath, file.path);
				}
				structural(file, oldPath);
			}),
		);
	}

	onRename(listener: (oldPath: string, newPath: string) => void): () => void {
		this.renameListeners.add(listener);
		return () => {
			this.renameListeners.delete(listener);
		};
	}

	/** Drops everything worked out from the vault listing, so it is worked out again. */
	private forgetResolutions(): void {
		this.tableList = null;
		this.resolvedPaths.clear();
		this.unavailable.clear();
	}

	/** Marks what is held for a path as stale. Called even when nothing is cached, so an in-flight
	 * read knows its answer is out of date before it lands. */
	private invalidate(path: string): void {
		this.versions.set(path, (this.versions.get(path) ?? 0) + 1);
	}

	private emit(): void {
		for (const listener of this.listeners) {
			listener();
		}
	}
}
