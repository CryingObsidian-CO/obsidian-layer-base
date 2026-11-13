import { readFileSync } from 'node:fs';

/* Every copy of the version must agree — manifest.json, package.json, versions.json and
 * the MCP server's announcement — and the release tag must match: Obsidian refuses a
 * mismatched tag, and a stale versions.json leaves users on an update that never arrives. */
const read = (file) => JSON.parse(readFileSync(file, 'utf8'));

const manifest = read('manifest.json');
const packageJson = read('package.json');
const versions = read('versions.json');

const problems = [];

if (manifest.version !== packageJson.version) {
	problems.push(
		`manifest.json is ${manifest.version} but package.json is ${packageJson.version}`,
	);
}

const mapped = versions[manifest.version];
if (mapped === undefined) {
	problems.push(`versions.json has no entry for ${manifest.version}`);
} else if (mapped !== manifest.minAppVersion) {
	problems.push(
		`versions.json maps ${manifest.version} to ${mapped}, but minAppVersion is ${manifest.minAppVersion}`,
	);
}

/* The server announces its version in source; matched loosely so the line may be reformatted. */
const mcpServer = readFileSync('mcp/server.ts', 'utf8');
const announced = /serverInfo:\s*\{[^}]*\bversion:\s*'([^']+)'/.exec(mcpServer);
if (announced === null) {
	problems.push(
		'mcp/server.ts announces no version in its serverInfo, so this check cannot compare it',
	);
} else if (announced[1] !== manifest.version) {
	problems.push(
		`mcp/server.ts announces ${announced[1]} but manifest.json is ${manifest.version}`,
	);
}

// `||`, not `??`: a variable set but empty is not an answer, and treating it as one
// would skip the comparison below and let a release from the wrong commit through.
const isTag = (process.env.GITHUB_REF ?? '').startsWith('refs/tags/');
const tag = process.env.EXPECTED_TAG || (isTag ? process.env.GITHUB_REF_NAME : '');
if (tag !== '' && tag !== manifest.version) {
	problems.push(`tag ${tag} does not match manifest version ${manifest.version}`);
}

if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) {
	problems.push(`manifest version "${manifest.version}" is not x.y.z`);
}

if (problems.length > 0) {
	for (const problem of problems) {
		console.error(`version check: ${problem}`);
	}
	process.exit(1);
}

console.log(`version check: ${manifest.version} is consistent`);
