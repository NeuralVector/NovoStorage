import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import config from '#config';
import { AUTH_OPERATIONS, type AuthOperations } from '#services/auth.ts';
import { PAGE_RENDERER, type PageRenderer } from '#utils/page-renderer.ts';

@Controller()
export class LandingController {
	constructor(
		@Inject(AUTH_OPERATIONS) private readonly auth: AuthOperations,
		@Inject(PAGE_RENDERER) private readonly renderer: PageRenderer
	) {}

	@Get()
	async landingHandler(
		@Req() request: FastifyRequest,
		@Res() reply: FastifyReply
	): Promise<void> {
		if (await this.auth.getCurrentUser(request)) {
			reply.redirect('/dashboard', 302);
			return;
		}

		await this.renderer.render(reply, 'landing');
	}
	@Get('login')
	loginHandler(@Res() reply: FastifyReply): FastifyReply {
		return this.auth.redirectToSignIn(reply, this.dashboardUrl());
	}

	@Get('signup')
	signupHandler(@Res() reply: FastifyReply): FastifyReply {
		return this.auth.redirectToSignUp(reply, this.dashboardUrl());
	}

	private dashboardUrl(): string {
		const url = new URL(config.get('website.url'));
		if (!url.port && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
			url.port = String(config.get('server.port'));
		}
		url.pathname = '/dashboard';
		url.search = '';
		url.hash = '';

		return url.toString();
	}
}
