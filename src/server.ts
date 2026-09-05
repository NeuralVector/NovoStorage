import 'reflect-metadata';
import { createApp } from '#app';
import config from '#config';

try {
	const app = await createApp();
	await app.listen(config.get('server.port'), config.get('server.host'));
} catch (error) {
	const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
	process.stderr.write(`Failed to start the application:\n${message}\n`);
	process.exitCode = 1;
}
