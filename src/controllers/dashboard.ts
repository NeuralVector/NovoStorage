import { Controller, Get, Inject, Res, Req } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { AUTH_OPERATIONS, type AuthOperations } from '#auth/auth.ts';
import { PAGE_RENDERER, type PageRenderer } from '#utils/page-renderer.ts';

@Controller('dashboard')
export class DashboardController {
	constructor(
		@Inject(PAGE_RENDERER) private readonly renderer: PageRenderer,
		@Inject(AUTH_OPERATIONS) private readonly auth: AuthOperations
	) {}

	@Get()
	async dashboardHandler(
		@Req() request: FastifyRequest,
		@Res() reply: FastifyReply
	): Promise<void> {
		if (!this.auth.getCurrentUser(request)) {
			reply.redirect('/login', 302);
			return;
		}
		await this.renderer.render(reply, 'dashboard');
	}
}
