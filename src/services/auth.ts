import { getAuth } from '@clerk/fastify';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import config from '#config';

export const AUTH_OPERATIONS = Symbol('AUTH_OPERATIONS');

export interface AuthenticatedUser {
	userId: string;
	sessionId: string | null;
}

export interface AuthOperations {
	getCurrentUser(request: FastifyRequest): AuthenticatedUser | null;
	requireUser(request: FastifyRequest): AuthenticatedUser;
	redirectToSignIn(reply: FastifyReply, redirectUrl: string): FastifyReply;
	redirectToSignUp(reply: FastifyReply, redirectUrl: string): FastifyReply;
}

@Injectable()
export class ClerkAuthOperations implements AuthOperations {
	private readonly accountPortalUrl = config.get('clerk.accountPortalUrl');

	getCurrentUser(request: FastifyRequest): AuthenticatedUser | null {
		const auth = getAuth(request);

		if (!auth.isAuthenticated || !auth.userId) {
			return null;
		}

		return {
			userId: auth.userId,
			sessionId: auth.sessionId
		};
	}

	requireUser(request: FastifyRequest): AuthenticatedUser {
		const user = this.getCurrentUser(request);

		if (!user) {
			throw new UnauthorizedException();
		}

		return user;
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
