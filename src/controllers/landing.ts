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
		const url = new URL(request.url, `${request.protocol}://${request.hostname}`);
		const hasClerkHandoff = ['__clerk_db_jwt', '__clerk_handshake'].some((name) =>
			url.searchParams.has(name)
		);

		if (hasClerkHandoff) {
			return reply.redirect(
				this.requestedRedirectUrl(request) ?? this.dashboardUrl(),
				302
			);
		}

		if (await this.auth.getCurrentUser(request)) {
			reply.redirect('/dashboard', 302);
			return;
		}

		await this.renderer.render(reply, 'landing');
	}
	@Get('login')
	loginHandler(@Req() request: FastifyRequest, @Res() reply: FastifyReply): FastifyReply {
		return this.auth.redirectToSignIn(reply, this.loginRedirectUrl(request));
	}

	@Get('signup')
	signupHandler(@Res() reply: FastifyReply): FastifyReply {
		return this.auth.redirectToSignUp(reply, this.dashboardUrl());
	}

	private dashboardUrl(): string {
		const url = this.websiteUrl();
		url.pathname = '/dashboard';
		url.search = '';
		url.hash = '';

		return url.toString();
	}

	private loginRedirectUrl(request: FastifyRequest): string {
		return this.requestedRedirectUrl(request) ?? this.dashboardUrl();
	}

	private requestedRedirectUrl(request: FastifyRequest): string | null {
		const requestUrl = new URL(
			request.url,
			`${request.protocol}://${request.hostname}`
		);
		const requestedUrl = requestUrl.searchParams.get('redirect_url');
		if (!requestedUrl) return null;

		try {
			const target = new URL(requestedUrl);
			if (target.origin === this.websiteUrl().origin) return target.toString();
		} catch {
			// Use the dashboard when the requested redirect is invalid.
		}

		return null;
	}

	private websiteUrl(): URL {
		const url = new URL(config.get('website.url'));
		if (!url.port && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
			url.port = String(config.get('server.port'));
		}
		return url;
	}
}
