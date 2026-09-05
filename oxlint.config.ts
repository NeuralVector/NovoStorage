import { defineConfig } from 'oxlint';

export default defineConfig({
	categories: {
		correctness: 'error',
		suspicious: 'warn',
		pedantic: 'off',
		perf: 'warn',
		style: 'off',
		restriction: 'off',
		nursery: 'off'
	},

	env: {
		node: true,
		builtin: true
	},

	globals: {
		Bun: 'readonly'
	},

	ignorePatterns: ['dist/**', 'coverage/**'],

	plugins: ['typescript', 'oxc', 'import', 'unicorn', 'node', 'promise'],

	options: {
		denyWarnings: false,
		maxWarnings: -1,
		reportUnusedDisableDirectives: 'error',
		respectEslintDisableDirectives: true,
		typeAware: false,
		typeCheck: false
	},

	overrides: [
		{
			files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx'],
			env: {
				vitest: true
			}
		}
	],

	rules: {}
});
