import { spawnSync } from 'node:child_process';

const containerName = 'novostorage-postgres';
const database = 'novostorage';
const user = 'novostorage';
const password = 'novostorage';

const run = (args) => {
	const result = spawnSync('podman', args, { stdio: 'inherit' });
	if (result.error) throw result.error;
	return result.status ?? 1;
};

if (process.argv[2] === 'stop') {
	process.exit(run(['stop', containerName]));
}

const exists = spawnSync('podman', ['container', 'exists', containerName]);
if (exists.status === 0) {
	run(['start', containerName]);
} else {
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

for (let attempt = 0; attempt < 30; attempt += 1) {
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
