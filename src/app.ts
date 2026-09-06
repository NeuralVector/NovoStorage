import 'reflect-metadata';
import { existsSync } from 'node:fs';
import path from 'node:path';

import fastifyMultipart from '@fastify/multipart';
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
	const developmentPublicDirectory = path.join(import.meta.dirname, '../dist/public');
	const sourceFrontendDirectory = path.join(import.meta.dirname, 'frontend');

	await fastify.register(fastifyStatic, {
		root: existsSync(builtPublicDirectory)
			? builtPublicDirectory
			: existsSync(developmentPublicDirectory)
				? developmentPublicDirectory
				: sourceFrontendDirectory
	});

	await fastify.register(fastifyMultipart, {
		limits: {
			fileSize: Infinity
		}
	});

	return app;
}
