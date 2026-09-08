// These routes create links, expose share metadata and accept shared files.
import {
	BadRequestException,
	Controller,
	Delete,
	Get,
	Inject,
	NotFoundException,
	Param,
	Post,
	Body,
	Req,
	Res
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import config from '#config';
import { AUTH_OPERATIONS, type AuthOperations } from '#services/auth.ts';
import { FILE_SHARING, type FileShare, type FileShareStore } from '#services/file-sharing.ts';
import { OBJECT_STORAGE, type ObjectStorage } from '#services/object-storage.ts';
import { STORAGE_REFERENCES, type StorageReferenceStore } from '#services/storage-references.ts';
import { PAGE_RENDERER, type PageRenderer } from '#utils/page-renderer.ts';
import { validateFilePath } from '#utils/storage-path.ts';

interface CreateShareBody {
	// Only a path is accepted; the authenticated owner is derived from the request.
	path?: string;
}

function shareUrl(token: string): string {
	// Build an absolute public URL from deployment configuration rather than assuming localhost.
	const url = new URL(config.get('website.url'));
	if (!url.port && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
		url.port = String(config.get('server.port'));
	}
	url.pathname = `/shared/${encodeURIComponent(token)}`;
	url.search = '';
	url.hash = '';
	return url.toString();
}

function shareResponse(share: FileShare): FileShare & { url: string } {
	// Keep the persisted share shape and add the convenient URL returned to the frontend.
	return { ...share, url: shareUrl(share.token) };
}

@Controller('api/shares')
export class ShareController {
	constructor(
		// Sharing needs auth, metadata stores, object existence checks, and virtual references.
		@Inject(AUTH_OPERATIONS) private readonly auth: AuthOperations,
		@Inject(FILE_SHARING) private readonly shares: FileShareStore,
		@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
		@Inject(STORAGE_REFERENCES)
		private readonly references: StorageReferenceStore
	) {}

	@Get()
	async listShares(@Req() request: FastifyRequest) {
		// Only the owner can enumerate their active share tokens.
		const user = await this.auth.requireUser(request);
		const shares = await this.shares.list(user.userId);
		return shares.map((share) => shareResponse(share));
	}

	@Post()
	async createShare(@Body() body: CreateShareBody, @Req() request: FastifyRequest) {
		// Only the owner of an existing file can create a share link.
		const user = await this.auth.requireUser(request);
		const path = validateFilePath(body?.path);
		const key = `${user.userId}/${path}`;
		const objects = await this.storage.list(user.userId);
		// Do not create a link for a missing object or a directory marker.
		if (!objects.some((object) => object.key === key)) {
			throw new NotFoundException('File not found.');
		}

		return shareResponse(await this.shares.create(user.userId, path));
	}

	@Get(':token')
	async getPublicShare(@Param('token') token: string) {
		// Expose only metadata needed by the public page; the token itself grants download access.
		const share = await this.shares.get(token);
		if (!share) throw new NotFoundException('Share link not found or revoked.');
		return {
			name: share.path.split('/').pop() ?? 'Shared file',
			ownerUserId: share.userId,
			createdAt: share.createdAt
		};
	}

	@Post(':token/accept')
	async acceptShare(@Param('token') token: string, @Req() request: FastifyRequest) {
		// Accepting creates a database reference; it does not copy file bytes.
		const user = await this.auth.requireUser(request);
		const share = await this.shares.get(token);
		if (!share) throw new NotFoundException('Share link not found or revoked.');

		const objectKey = `${share.userId}/${share.path}`;
		const objects = await this.storage.list(share.userId);
		// Validate the source still exists before creating a recipient reference.
		if (!objects.some((object) => object.key === objectKey)) {
			throw new NotFoundException('Shared file no longer exists.');
		}

		return this.references.create(
			user.userId,
			share.userId,
			objectKey,
			share.path.split('/').pop() ?? 'Shared file'
		);
	}

	@Delete(':token')
	async revokeShare(
		@Param('token') token: string,
		@Req() request: FastifyRequest
	): Promise<void> {
		// Ownership is checked before revoking both the public token and references it created.
		if (!token) throw new BadRequestException('A share token is required.');
		const user = await this.auth.requireUser(request);
		const share = await this.shares.get(token);
		if (!share || share.userId !== user.userId) {
			throw new NotFoundException('Share link not found.');
		}
		await this.references.revokeForObject(
			share.userId,
			`${share.userId}/${share.path}`
		);
		await this.shares.revoke(user.userId, token);
	}
}

@Controller('shared')
export class PublicShareController {
	constructor(
		// Public routes need only share lookup, object lookup, and HTML rendering.
		@Inject(FILE_SHARING) private readonly shares: FileShareStore,
		@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
		@Inject(PAGE_RENDERER) private readonly renderer: PageRenderer
	) {}

	@Get(':token')
	async showSharedFile(
		@Param('token') token: string,
		@Res() reply: FastifyReply
	): Promise<void> {
		// The HTML page is public, but the actual download still validates the share token.
		const share = await this.shares.get(token);
		if (!share) throw new NotFoundException('Share link not found or revoked.');
		await this.renderer.render(reply, 'shared');
	}

	@Get(':token/download')
	async downloadSharedFile(
		@Param('token') token: string,
		@Res() reply: FastifyReply
	): Promise<void> {
		const share = await this.shares.get(token);
		if (!share) throw new NotFoundException('Share link not found or revoked.');

		const key = `${share.userId}/${share.path}`;
		const objects = await this.storage.list(share.userId);
		if (!objects.some((object) => object.key === key)) {
			throw new NotFoundException('Shared file no longer exists.');
		}

		const object = await this.storage.download(key);
		// Prefer the stored content type while retaining a safe binary fallback.
		const fileName = share.path.split('/').pop() ?? 'download';
		reply.header('Content-Type', object.contentType ?? 'application/octet-stream');
		reply.header(
			'Content-Disposition',
			`attachment; filename="${encodeURIComponent(fileName)}"`
		);
		reply.send(object.stream);
	}
}
