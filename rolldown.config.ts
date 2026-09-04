import { defineConfig } from 'rolldown';

export default defineConfig({
	input: 'src/server.ts',
	platform: 'node',
	output: {
		dir: 'dist',
		format: 'esm',
		sourcemap: true,
		minify: true
	}
});
