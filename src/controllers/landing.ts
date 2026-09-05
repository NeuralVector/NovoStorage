import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { PAGE_RENDERER, type PageRenderer } from '../utils/page-renderer.ts';

@Controller()
export class LandingController {
	constructor(@Inject(PAGE_RENDERER) private readonly renderer: PageRenderer) {}

	@Get()
	async landingHandler(@Res() reply: FastifyReply): Promise<void> {
		await this.renderer.render(reply, 'landing');
	}
}
