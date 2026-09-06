import { spawn } from 'node:child_process';
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '..');
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

mkdirSync(path.join(projectRoot, 'dist/public'), { recursive: true });
cpSync(path.join(projectRoot, 'src/frontend/views'), path.join(projectRoot, 'dist/public/views'), {
	recursive: true
});
cpSync(
	path.join(projectRoot, 'src/frontend/assets'),
	path.join(projectRoot, 'dist/public/assets'),
	{ recursive: true }
);

const frontend = spawn(runtime, frontendArguments, {
	cwd: projectRoot,
	stdio: 'inherit'
});
const server = spawn(runtime, serverArguments, {
	cwd: projectRoot,
	stdio: 'inherit'
});

let shuttingDown = false;
const shutdown = (exitCode = 0) => {
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
	if (!shuttingDown) {
		shutdown(code ?? (signal ? 1 : 0));
	}
});
