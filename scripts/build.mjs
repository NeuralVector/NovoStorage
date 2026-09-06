import { spawnSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
const distDirectory = path.join(projectRoot, 'dist');

rmSync(distDirectory, { recursive: true, force: true });

const result = spawnSync(
	process.execPath,
	['--import=tsx/esm', 'node_modules/rolldown/dist/cli.mjs', '-c'],
	{ cwd: projectRoot, stdio: 'inherit' }
);

if (result.status !== 0) {
	process.exit(result.status ?? 1);
}

cpSync(path.join(projectRoot, 'src/frontend/views'), path.join(projectRoot, 'dist/public/views'), {
	recursive: true
});
cpSync(
	path.join(projectRoot, 'src/frontend/assets'),
	path.join(projectRoot, 'dist/public/assets'),
	{ recursive: true }
);
