import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		// Built from mcp/, and not part of the plugin bundle.
		'mcp-server.cjs',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
		// Local maintenance scripts; not part of the plugin bundle.
		'scripts',
		// Session and Agent Teams scratch directories, which the plugin never ships.
		'.dsh-*/**',
		'.agent-teams/**',
		// A local code-review export, not part of the plugin.
		'review.html',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		/*
		 * The MCP server is a standalone Node program: it runs outside Obsidian, so the
		 * plugin's rules about mobile support and the config folder do not apply to it.
		 * Last on purpose — the shared rules would otherwise switch them back on.
		 */
		files: ['mcp/**/*.ts'],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
			'obsidianmd/hardcoded-config-path': 'off',
		},
	},
	{
		/*
		 * The tests run in Node too: reading a temporary folder is how a rule about
		 * files can be tested at all. None of it reaches the bundle that ships.
		 */
		files: ['tests/**/*.ts'],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			'obsidianmd/no-nodejs-modules': 'off',
		},
	},
);
