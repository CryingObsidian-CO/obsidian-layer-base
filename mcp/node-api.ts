/*
 * The one place in this server that names Node.
 *
 * Node's own declarations are a dev dependency, and a checker that does not load
 * them sees every `realpathSync` call and every `process.env` as an unresolved
 * value; each use of one then reads as an unsafe value — a hundred of them, in
 * files that are otherwise plain string handling. The signatures this server
 * relies on are written out here once, so everything downstream of this module
 * is a string, a list of them, or a number, whether or not the declarations were
 * there to be read.
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

/** An entry of a directory listing, as `readdirSync(..., { withFileTypes: true })` gives them. */
export interface DirEntry {
	readonly name: string;
	isDirectory(): boolean;
}

/*
 * Functions, not methods: a method lifted out of its object loses its `this`, and
 * the calls below hand these on as plain functions.
 */
interface FsApi {
	readFileSync: (path: string, encoding: 'utf8') => string;
	writeFileSync: (
		path: string,
		data: string,
		options: 'utf8' | { encoding: 'utf8'; flag: 'wx' },
	) => void;
	renameSync: (oldPath: string, newPath: string) => void;
	unlinkSync: (path: string) => void;
	existsSync: (path: string) => boolean;
	readdirSync: (path: string, options: { withFileTypes: true }) => DirEntry[];
	statSync: (path: string) => { isDirectory(): boolean };
	mkdirSync: (path: string, options: { recursive: true }) => void;
	/** The form that follows a junction; the plain one does not, on Windows. */
	realpathSync: { native: (path: string) => string };
}

interface PathApi {
	basename: (path: string, suffix?: string) => string;
	dirname: (path: string) => string;
	isAbsolute: (path: string) => boolean;
	join: (...parts: string[]) => string;
	relative: (from: string, to: string) => string;
	resolve: (...parts: string[]) => string;
	sep: string;
}

const fs = nodeFs as unknown as FsApi;
const paths = nodePath as unknown as PathApi;

export const readFileSync = fs.readFileSync;
export const writeFileSync = fs.writeFileSync;
export const renameSync = fs.renameSync;
export const unlinkSync = fs.unlinkSync;
export const existsSync = fs.existsSync;
export const readdirSync = fs.readdirSync;
export const statSync = fs.statSync;
export const mkdirSync = fs.mkdirSync;
export const realpathNative = fs.realpathSync.native;

export const basename = paths.basename;
export const dirname = paths.dirname;
export const isAbsolute = paths.isAbsolute;
export const join = paths.join;
export const relative = paths.relative;
export const resolve = paths.resolve;
export const sep = paths.sep;

/** The process surface this server uses, named for the same reason as the rest. */
interface ProcessApi {
	env: Record<string, string | undefined>;
	argv: string[];
	stdin: {
		setEncoding: (encoding: 'utf8') => void;
		on: (event: 'data', listener: (chunk: string) => void) => void;
	};
	stdout: { write: (text: string) => void };
	exit: (code: number) => void;
}

/*
 * Declared rather than reached for: a Node program is handed `process`, and the
 * file this one lives in has nothing to import it from. The declaration shadows
 * the global in this module only.
 */
declare const process: ProcessApi;

export const proc = process;
