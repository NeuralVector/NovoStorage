// Public landing and authentication-entry routes live here.
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
		// Construct a URL once so both Clerk handoff detection and redirect validation use the same origin.
		// Build the current request URL so Clerk handoff query parameters can be inspected.
		const url = new URL(request.url, `${request.protocol}://${request.hostname}`);
		const hasClerkHandoff = ['__clerk_db_jwt', '__clerk_handshake'].some((name) =>
			url.searchParams.has(name)
		);

		if (hasClerkHandoff) {
			// Clerk may return a temporary handoff token to the root route.
			return reply.redirect(
				this.requestedRedirectUrl(request) ?? this.dashboardUrl(),
				302
			);
		}

		if (await this.auth.getCurrentUser(request)) {
			// Already-authenticated visitors do not need to see the public landing page.
			reply.redirect('/dashboard', 302);
			return;
		}

		await this.renderer.render(reply, 'landing');
	}
	@Get('login')
	loginHandler(@Req() request: FastifyRequest, @Res() reply: FastifyReply): FastifyReply {
		// Preserve a safe requested destination through the external Clerk account portal.
		return this.auth.redirectToSignIn(reply, this.loginRedirectUrl(request));
	}

	@Get('signup')
	signupHandler(@Res() reply: FastifyReply): FastifyReply {
		// New accounts always start at the dashboard after completing sign-up.
		return this.auth.redirectToSignUp(reply, this.dashboardUrl());
	}

	private dashboardUrl(): string {
		// Use the configured public website instead of hardcoding localhost.
		const url = this.websiteUrl();
		url.pathname = '/dashboard';
		url.search = '';
		url.hash = '';

		return url.toString();
	}

	private loginRedirectUrl(request: FastifyRequest): string {
		// Use the requested same-origin destination when present, otherwise use the normal dashboard.
		return this.requestedRedirectUrl(request) ?? this.dashboardUrl();
	}

	private requestedRedirectUrl(request: FastifyRequest): string | null {
		// Only same-origin redirect targets are accepted to prevent open redirects.
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
		// Local development often omits the port from WEBSITE_URL, so inherit the configured server port.
		const url = new URL(config.get('website.url'));
		if (!url.port && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
			url.port = String(config.get('server.port'));
		}
		return url;
	}
}
