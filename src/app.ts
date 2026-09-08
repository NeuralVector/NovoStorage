// This function creates the HTTP application and registers its plugins.
import 'reflect-metadata';
import { existsSync } from 'node:fs';
import path from 'node:path';

import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';

import { AppModule } from '#app-module';

export async function createApp() {
	// Nest uses Fastify as its underlying web server in this project; the adapter lets Nest's
	// dependency-injection and decorators coexist with Fastify's streaming HTTP primitives.
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

	// Get the native Fastify instance so Fastify plugins can be registered.
	const fastify = app.getHttpAdapter().getInstance();
	// Bundled deployments place public files beside the server, while development uses dist or source.
	const builtPublicDirectory = path.join(import.meta.dirname, 'public');
	const developmentPublicDirectory = path.join(import.meta.dirname, '../dist/public');
	const sourceFrontendDirectory = path.join(import.meta.dirname, 'frontend');

	await fastify.register(fastifyStatic, {
		// Prefer build output, while still allowing source files during development.
		root: existsSync(builtPublicDirectory)
			? builtPublicDirectory
			: existsSync(developmentPublicDirectory)
				? developmentPublicDirectory
				: sourceFrontendDirectory
	});

	await fastify.register(fastifyMultipart, {
		// Streaming upload size is checked by the application and quota service, so the multipart
		// plugin must not reject a request before the application can compare declared and actual size.
		limits: {
			fileSize: Infinity
		}
	});

	return app;
}
