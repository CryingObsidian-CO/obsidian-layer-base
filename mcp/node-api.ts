/*
 * The one place in this server that names Node. Node's declarations are a dev dependency, and
 * a checker without them reads every call as an unsafe value; the signatures used here are
 * written out once so everything downstream is plainly typed.
 */
import * as nodeFs from 'node:fs';
import * as nodePath from 'node:path';

/** The part of a `readdirSync` entry this server uses. */
export interface DirEntry {
	readonly name: string;
	isDirectory(): boolean;
}

/* Functions, not methods: a lifted method loses its `this`, and the calls below hand these on. */
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

/* Declared locally: a Node program is handed `process`, and this file has nothing to import it from. */
declare const process: ProcessApi;

export const proc = process;
