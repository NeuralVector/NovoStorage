// Start watch-mode frontend and server processes for development.
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
// The first argument chooses Node.js or Bun as the development runtime.
const runtime = process.argv[2] ?? 'node';

if (runtime !== 'node' && runtime !== 'bun') {
	throw new Error(`Unsupported runtime: ${runtime}`);
}

const runtimeArguments = runtime === 'node' ? ['--import=tsx/esm'] : [];
const frontendArguments = [
	...runtimeArguments,
	'node_modules/rolldown/dist/cli.mjs',
	'-c',
	'--watch'
];
const serverArguments = [...runtimeArguments, '--watch', 'src/server.ts'];

// Seed static files once because the module watcher only rebuilds JavaScript bundles.
mkdirSync(path.join(projectRoot, 'dist/public'), { recursive: true });
cpSync(path.join(projectRoot, 'src/frontend/views'), path.join(projectRoot, 'dist/public/views'), {
	recursive: true
});
cpSync(
	path.join(projectRoot, 'src/frontend/assets'),
	path.join(projectRoot, 'dist/public/assets'),
	{ recursive: true }
);

// The frontend watcher rebuilds browser bundles when source files change.
const frontend = spawn(runtime, frontendArguments, {
	cwd: projectRoot,
	stdio: 'inherit'
});
// The server watcher restarts the API when server source files change.
const server = spawn(runtime, serverArguments, {
	cwd: projectRoot,
	stdio: 'inherit'
});

let shuttingDown = false;
const shutdown = (exitCode = 0) => {
	// Prevent duplicate signal/exit handling from trying to terminate children twice.
	if (shuttingDown) {
		return;
	}
	shuttingDown = true;
	frontend.kill();
	server.kill();
	process.exitCode = exitCode;
};

process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
server.on('exit', (code, signal) => {
	// If the server stops unexpectedly, stop the frontend watcher and propagate its reason.
	if (!shuttingDown) {
		shutdown(code ?? (signal ? 1 : 0));
	}
});
