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
 * Where a path really is, following every link on its way there.
 *
 * The `native` form and not the plain one: on Windows the JavaScript version
 * does not follow a junction, and a junction is exactly the link a user can make
 * without administrator rights.
 *
 * A path that does not exist yet — the writer's case — is measured from its
 * nearest existing ancestor, so a link higher up the path is still followed
 * rather than skipped.
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
				// Nothing on this path exists; the answer cannot be improved.
				return path;
			}
			tail.unshift(basename(head));
			head = parent;
		}
	}
}

/**
 * Whether a path relative to some root stays under it.
 *
 * `..` alone is the root's parent; `..notes` is an ordinary name that merely
 * begins with two dots, and refusing those would refuse real files.
 */
export function staysInside(relPath: string): boolean {
	return (
		relPath === '' ||
		(relPath !== '..' && !relPath.startsWith(`..${sep}`) && !isAbsolute(relPath))
	);
}

/**
 * A guard for one vault: resolves a vault-relative path, or refuses it.
 *
 * Two questions, because either alone is not enough. The first is about the words
 * in the path — the one that catches `../elsewhere`. The second is about where the
 * file really is: a link inside the vault can point out of it, and every read and
 * write that follows the path follows that link too.
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
