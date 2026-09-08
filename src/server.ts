// Executable server entry point used by the start scripts.
import 'reflect-metadata';
import { createApp } from '#app';
import config from '#config';

try {
	// Creating the app initializes Nest and all registered services.
	const app = await createApp();
	// listen resolves only after the operating-system socket is bound successfully.
	// Host and port are configurable for local, EC2 and reverse-proxy deployments.
	await app.listen(config.get('server.port'), config.get('server.host'));
} catch (error) {
	// A startup error should be visible and should make the process fail explicitly.
	const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
	process.stderr.write(`Failed to start the application:\n${message}\n`);
	process.exitCode = 1;
}
