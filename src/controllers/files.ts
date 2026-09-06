import {
	BadRequestException,
	Body,
	Controller,
	Get,
	Inject,
	Post,
	Query,
	Req,
	Res
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { FastifyReply } from 'fastify';

import { AUTH_OPERATIONS, type AuthOperations } from '#services/auth.ts';
import { OBJECT_STORAGE, type ObjectStorage } from '#services/object-storage.ts';

interface StorageItem {
	name: string;
	path: string;
	type: 'file' | 'directory';
	size: number;
}

interface CreateDirectoryBody {
	name?: string;
	parent?: string;
}

function validateRelativePath(value: string | undefined): string {
	const path =
		value
			?.trim()
			.replaceAll('\\', '/')
			.replace(/^\/+|\/+$/g, '') ?? '';
	if (!path) return '';
	if (path.split('/').some((part) => !part || part === '.' || part === '..')) {
		throw new BadRequestException('A valid directory path is required.');
	}
	return path;
}

@Controller('api')
export class FilesController {
	constructor(
		@Inject(AUTH_OPERATIONS) private readonly auth: AuthOperations,
		@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage
	) {}

	@Get('files')
	async listFiles(@Req() request: FastifyRequest): Promise<StorageItem[]> {
		const user = await this.auth.requireUser(request);
		const objects = await this.storage.list(user.userId);
		const items = new Map<string, StorageItem>();
		const userPrefix = `${user.userId}/`;

		for (const object of objects) {
			const key = object.key;
			const relativeKey = key.startsWith(userPrefix)
				? key.slice(userPrefix.length)
				: key;
			const parts = relativeKey.split('/').filter(Boolean);

			for (let index = 0; index < parts.length; index += 1) {
				const path = parts.slice(0, index + 1).join('/');
				const isDirectory =
					index < parts.length - 1 || relativeKey.endsWith('/');

				items.set(path, {
					name: parts[index]!,
					path,
					type: isDirectory ? 'directory' : 'file',
					size: isDirectory ? 0 : object.size
				});
			}
		}

		return [...items.values()].sort((left, right) =>
			left.path.localeCompare(right.path)
		);
	}

	@Get('files/download')
	async downloadFile(
		@Query('path') filePath: string,
		@Req() request: FastifyRequest,
		@Res() reply: FastifyReply
	): Promise<void> {
		const user = await this.auth.requireUser(request);
		const normalizedPath = filePath?.replaceAll('\\', '/');

		if (
			!normalizedPath ||
			normalizedPath.startsWith('/') ||
			normalizedPath.split('/').some((part) => part === '..')
		) {
			throw new BadRequestException('A valid file path is required.');
		}

		const key = `${user.userId}/${normalizedPath}`;
		const fileName = normalizedPath.split('/').pop() ?? 'download';
		const stream = await this.storage.download(key);

		reply.header('Content-Type', 'application/octet-stream');
		reply.header(
			'Content-Disposition',
			`attachment; filename="${encodeURIComponent(fileName)}"`
		);
		reply.send(stream);
	}

	@Post('files')
	async uploadFile(
		@Query('path') directoryPath: string,
		@Req() request: FastifyRequest
	): Promise<{ key: string }> {
		const user = await this.auth.requireUser(request);
		const file = await request.file();

		if (!file) {
			throw new BadRequestException('A file is required.');
		}

		const fileName = file.filename.replaceAll('\\', '/').split('/').pop();
		if (!fileName) {
			throw new BadRequestException('The uploaded file must have a name.');
		}

		const path = validateRelativePath(directoryPath);
		const key = `${user.userId}/${path ? `${path}/` : ''}${fileName}`;
		await this.storage.upload(key, await file.toBuffer(), file.mimetype);

		return { key };
	}

	@Post('directories')
	async createDirectory(
		@Body() body: CreateDirectoryBody,
		@Req() request: FastifyRequest
	): Promise<{ key: string }> {
		const user = await this.auth.requireUser(request);
		const name = body?.name?.trim();
		const parent = validateRelativePath(body?.parent);

		if (
			!name ||
			name === '.' ||
			name === '..' ||
			name.includes('/') ||
			name.includes('\\')
		) {
			throw new BadRequestException('A valid directory name is required.');
		}

		const key = `${user.userId}/${parent ? `${parent}/` : ''}${name}/`;
		await this.storage.createDirectory(key);

		return { key };
	}
}
