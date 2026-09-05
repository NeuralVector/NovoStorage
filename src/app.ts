import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';

import { AppModule } from './app.module.ts';

export const app = await NestFactory.create(AppModule, new FastifyAdapter());

export default app;
