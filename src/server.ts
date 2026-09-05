import app from './app.ts';
import config from './config.ts';
import 'reflect-metadata';

await app.listen(config.get('server.port'), config.get('server.host'));
