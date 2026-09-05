import 'reflect-metadata';
import fastifyStatic from '@fastify/static';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.ts';

export const app = await NestFactory.create(AppModule, new FastifyAdapter());

const fastify = app.getHttpAdapter().getInstance();

await fastify.register(fastifyStatic, {
	root: new URL('../public/', import.meta.url),
	wildcard: false
});

export default app;
