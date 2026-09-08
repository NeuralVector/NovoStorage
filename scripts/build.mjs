// Build server/frontend bundles and copy static source assets into dist.
import { spawnSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const distDirectory = path.join(projectRoot, 'dist');

// dist is generated output, so it is safe to recreate it on every build.
rmSync(distDirectory, { recursive: true, force: true });

// The bundler emits executable server/frontend JavaScript; HTML and assets are copied separately
// because they are static files rather than module entry points.

// Rolldown bundles the server and browser entry points.
const result = spawnSync(
	process.execPath,
	['--import=tsx/esm', 'node_modules/rolldown/dist/cli.mjs', '-c'],
	{ cwd: projectRoot, stdio: 'inherit' }
);

if (result.status !== 0) {
	// Preserve the bundler's failure status so CI and package scripts stop immediately.
	process.exit(result.status ?? 1);
}

cpSync(path.join(projectRoot, 'src/frontend/views'), path.join(projectRoot, 'dist/public/views'), {
	// Keep server-rendered HTML beside the bundled browser scripts.
	recursive: true
});
cpSync(
	path.join(projectRoot, 'src/frontend/assets'),
	path.join(projectRoot, 'dist/public/assets'),
	{ recursive: true }
);
