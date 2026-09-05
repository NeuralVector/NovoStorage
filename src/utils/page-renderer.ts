import type { FastifyReply } from 'fastify';

export const PAGE_RENDERER = Symbol('PAGE_RENDERER');

export interface PageRenderer {
	render(reply: FastifyReply, page: string): Promise<void>;
}

export class StaticPageRenderer implements PageRenderer {
	async render(reply: FastifyReply, page: string): Promise<void> {
		reply.sendFile(`views/${page}.html`);
	}
}
