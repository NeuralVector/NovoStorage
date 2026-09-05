import app from './app.ts';
import config from './config.ts';

await app.listen({
	host: config.get('server.host'),
	port: config.get('server.port')
});
