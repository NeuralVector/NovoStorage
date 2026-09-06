import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { PAGE_RENDERER, type PageRenderer } from '#utils/page-renderer.ts';

@Controller('dashboard')
export class DashboardController {
	constructor(@Inject(PAGE_RENDERER) private readonly renderer: PageRenderer) {}

	@Get()
	async dashboardHandler(@Res() reply: FastifyReply): Promise<void> {
		await this.renderer.render(reply, 'dashboard');
	}
}
