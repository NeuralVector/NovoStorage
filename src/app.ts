import 'reflect-metadata';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { clerkPlugin } from '@clerk/fastify';
import fastifyStatic from '@fastify/static';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';

import { AppModule } from '#app-module';

export async function createApp() {
	const app = await NestFactory.create(
		AppModule,
		new FastifyAdapter({
			logger: {
				transport: {
					target: 'pino-pretty',
					options: {
						colorize: true,
						translateTime: 'SYS:standard',
						ignore: 'pid,hostname'
					}
				}
			}
		})
	);

	const fastify = app.getHttpAdapter().getInstance();
	const builtPublicDirectory = path.join(import.meta.dirname, 'public');
	const sourcePublicDirectory = path.join(import.meta.dirname, '../public');

	await fastify.register(fastifyStatic, {
		root: existsSync(builtPublicDirectory)
			? builtPublicDirectory
			: sourcePublicDirectory
	});

	await fastify.register(clerkPlugin);

	return app;
}
