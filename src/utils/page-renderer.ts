// Controllers use this abstraction instead of knowing where HTML files live.
import type { FastifyReply } from 'fastify';

export const PAGE_RENDERER = Symbol('PAGE_RENDERER');

export interface PageRenderer {
	// Controllers depend on this contract, which keeps page lookup/hosting details replaceable.
	render(reply: FastifyReply, page: string): Promise<void>;
}

export class StaticPageRenderer implements PageRenderer {
	async render(reply: FastifyReply, page: string): Promise<void> {
		// Fastify's static plugin resolves the relative view path from the configured public root.
		reply.sendFile(`views/${page}.html`);
	}
}
