import { defineConfig } from 'oxfmt';

export default defineConfig({
	arrowParens: 'always',
	bracketSameLine: false,
	bracketSpacing: true,

	embeddedLanguageFormatting: 'auto',

	endOfLine: 'lf',
	experimentalOperatorPosition: 'end',

	htmlWhitespaceSensitivity: 'css',

	ignorePatterns: [
		'node_modules/**',
		'dist/**',
		'build/**',
		'coverage/**',
		'.next/**',
		'.turbo/**',
		'pnpm-lock.yaml',
		'pnpm-workspace.yaml',
		'lefthook.yaml',
		'lefthook.yml'
	],

	insertFinalNewline: true,

	jsxSingleQuote: true,

	objectWrap: 'preserve',

	printWidth: 100,

	proseWrap: 'preserve',

	quoteProps: 'as-needed',

	semi: true,

	singleAttributePerLine: false,

	singleQuote: true,

	sortImports: {
		groups: [
			'builtin',
			'external',
			['internal', 'subpath'],
			['parent', 'sibling', 'index'],
			'style',
			'unknown',
		],
		ignoreCase: true,
		internalPattern: ['~/', '@/', '#'],
		newlinesBetween: true,
		order: 'asc',
		partitionByComment: true,
		sortSideEffects: false,
	},

	sortPackageJson: {
		sortScripts: false,
	},

	tabWidth: 8,

	trailingComma: 'none',

	useTabs: true,
});
