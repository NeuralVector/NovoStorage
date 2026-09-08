// Starts and checks the local PostgreSQL container used by development.
import { spawnSync } from 'node:child_process';

const containerName = 'novostorage-postgres';
const database = 'novostorage';
const user = 'novostorage';
const password = 'novostorage';

// These development-only defaults match the connection URL in src/config.ts.

// Run a Podman command and inherit its output so failures are visible.
const run = (args) => {
	const result = spawnSync('podman', args, { stdio: 'inherit' });
	if (result.error) throw result.error;
	return result.status ?? 1;
};

// `pnpm db:stop` passes the stop argument here.
if (process.argv[2] === 'stop') {
	// Stopping is intentionally handled before readiness checks so the command is fast and explicit.
	process.exit(run(['stop', containerName]));
}

// Reuse an existing container; otherwise create a new one.
const exists = spawnSync('podman', ['container', 'exists', containerName]);
if (exists.status === 0) {
	// A stopped container retains its named volume and can be started without recreating it.
	run(['start', containerName]);
} else {
	// First run creates both the container and the persistent database volume.
	run([
		'run',
		'--detach',
		'--name',
		containerName,
		'--env',
		`POSTGRES_DB=${database}`,
		'--env',
		`POSTGRES_USER=${user}`,
		'--env',
		`POSTGRES_PASSWORD=${password}`,
		'--publish',
		'5432:5432',
		'--volume',
		'novostorage-postgres-data:/var/lib/postgresql/data',
		'docker.io/library/postgres:17-alpine'
	]);
}

// PostgreSQL may need a few seconds before it accepts connections.
for (let attempt = 0; attempt < 30; attempt += 1) {
	// Poll rather than sleeping a fixed duration so fast and slow machines both work reliably.
	const ready = spawnSync('podman', [
		'exec',
		containerName,
		'pg_isready',
		'--username',
		user,
		'--dbname',
		database
	]);
	if (ready.status === 0) process.exit(0);
	await new Promise((resolve) => setTimeout(resolve, 500));
}

throw new Error('PostgreSQL did not become ready in time.');
