import fg from 'fast-glob';
import { defineConfig } from 'rolldown';

const clerkPublishableKey = process.env['CLERK_PUBLISHABLE_KEY'];
if (!clerkPublishableKey) {
	throw new Error('CLERK_PUBLISHABLE_KEY is not set');
}

export default defineConfig([
	{
		input: 'src/server.ts',
		platform: 'node',
		output: {
			dir: 'dist',
			format: 'esm',
			sourcemap: true,
			minify: true
		},
		external: (id) => id.startsWith('@nestjs/')
	},
	{
		input: fg.sync('src/frontend/**/*.ts'),
		platform: 'browser',
		output: {
			dir: 'dist/public/assets',
			format: 'esm',
			sourcemap: true,
			minify: true
		},
		transform: {
			define: {
				CLERK_PUBLISHABLE_KEY: JSON.stringify(clerkPublishableKey)
			}
		}
	}
]);
