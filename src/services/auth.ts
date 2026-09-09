import { clerkClient } from '@clerk/fastify';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import config from '#config';

export const AUTH_OPERATIONS = Symbol('AUTH_OPERATIONS');

export interface AuthenticatedUser {
	userId: string;
	sessionId: string | null;
}

export interface AuthOperations {
	getCurrentUser(request: FastifyRequest): Promise<AuthenticatedUser | null>;
	requireUser(request: FastifyRequest): Promise<AuthenticatedUser>;
	getUserDisplayName(userId: string): Promise<string>;
	redirectToSignIn(reply: FastifyReply, redirectUrl: string): FastifyReply;
	redirectToSignUp(reply: FastifyReply, redirectUrl: string): FastifyReply;
}

@Injectable()
export class ClerkAuthOperations implements AuthOperations {
	private readonly accountPortalUrl = config.get('clerk.accountPortalUrl');
	private readonly publishableKey: string;

	constructor() {
		const publishableKey = process.env['CLERK_PUBLISHABLE_KEY'];
		if (!publishableKey) {
			throw new Error('CLERK_PUBLISHABLE_KEY is required');
		}
		this.publishableKey = publishableKey;
	}

	async getCurrentUser(request: FastifyRequest): Promise<AuthenticatedUser | null> {
		const headers = new Headers();
		for (const [name, value] of Object.entries(request.headers)) {
			if (typeof value === 'string') headers.set(name, value);
			else if (Array.isArray(value)) headers.set(name, value.join(', '));
		}

		const url = new URL(request.url, `${request.protocol}://${request.hostname}`);
		const requestState = await clerkClient.authenticateRequest(
			new Request(url, {
				method: request.method,
				headers
			}),
			{
				acceptsToken: 'session_token',
				publishableKey: this.publishableKey
			}
		);

		if (requestState.status !== 'signed-in') {
			return null;
		}

		const auth = requestState.toAuth();

		return {
			userId: auth.userId,
			sessionId: auth.sessionId
		};
	}

	async requireUser(request: FastifyRequest): Promise<AuthenticatedUser> {
		const user = await this.getCurrentUser(request);

		if (!user) {
			throw new UnauthorizedException();
		}

		return user;
	}

	async getUserDisplayName(userId: string): Promise<string> {
		// Shared-file metadata should show a human-readable owner without exposing Clerk IDs.
		try {
			const user = await clerkClient.users.getUser(userId);
			return (
				user.fullName ??
				([user.firstName, user.lastName].filter(Boolean).join(' ') ||
					user.username ||
					user.primaryEmailAddress?.emailAddress ||
					'Unknown user')
			);
		} catch {
			// The reference may outlive a deleted Clerk account; keep the file visible with a neutral label.
			return 'Unknown user';
		}
	}

	redirectToSignIn(reply: FastifyReply, redirectUrl: string): FastifyReply {
		return this.redirectToAccountPortal(reply, '/sign-in', redirectUrl);
	}

	redirectToSignUp(reply: FastifyReply, redirectUrl: string): FastifyReply {
		return this.redirectToAccountPortal(reply, '/sign-up', redirectUrl);
	}

	private redirectToAccountPortal(
		reply: FastifyReply,
		path: string,
		redirectUrl: string
	): FastifyReply {
		const url = new URL(path, this.accountPortalUrl);
		url.searchParams.set('redirect_url', redirectUrl);

		return reply.redirect(url.toString(), 302);
	}
}
