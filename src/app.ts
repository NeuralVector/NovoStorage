import 'reflect-metadata';
import { clerkPlugin } from '@clerk/fastify';
import fastifyStatic from '@fastify/static';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';

import { AppModule } from '#app-module';

export async function createApp() {
	const app = await NestFactory.create(
		AppModule,
		new FastifyAdapter({
			logger: true
		}),
		{
			logger: false,
			abortOnError: false
		}
	);

	const fastify = app.getHttpAdapter().getInstance();

	await fastify.register(fastifyStatic, {
		root: new URL('../public/', import.meta.url),
		wildcard: false
	});

	await fastify.register(clerkPlugin);

	return app;
}
