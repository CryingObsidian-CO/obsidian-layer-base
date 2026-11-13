import {
	basename,
	dirname,
	isAbsolute,
	join,
	realpathNative,
	relative,
	resolve,
	sep,
} from './node-api';

/**
 * `.native` follows a junction on Windows (the plain version does not), and a path that
 * does not exist yet is resolved from its nearest existing ancestor so links higher up count.
 */
export function realPath(path: string): string {
	let head = path;
	const tail: string[] = [];
	for (;;) {
		try {
			const real = realpathNative(head);
			return tail.length === 0 ? real : join(real, ...tail);
		} catch {
			const parent = dirname(head);
			if (parent === head) {
				return path;
			}
			tail.unshift(basename(head));
			head = parent;
		}
	}
}

/** `..` alone is the parent; `..notes` is an ordinary name and refusing it would refuse real files. */
export function staysInside(relPath: string): boolean {
	return (
		relPath === '' ||
		(relPath !== '..' && !relPath.startsWith(`..${sep}`) && !isAbsolute(relPath))
	);
}

/**
 * Resolves a vault-relative path or refuses it: once lexically (the `../elsewhere` case) and
 * once by real location, because a link inside the vault can point out of it.
 */
export function vaultGuard(vaultRoot: string): (path: unknown) => string {
	const root = resolve(vaultRoot);
	const realRoot = realPath(root);

	return (path: unknown): string => {
		if (typeof path !== 'string' || path.trim() === '') {
			throw new Error('A table path is required');
		}
		const full = resolve(root, path);
		if (!staysInside(relative(root, full))) {
			throw new Error(`Outside the vault: ${path}`);
		}
		if (!staysInside(relative(realRoot, realPath(full)))) {
			throw new Error(`Outside the vault: ${path} points out of it through a link`);
		}
		return full;
	};
}
