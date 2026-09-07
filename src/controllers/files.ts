import { Transform } from 'node:stream';

import {
	BadRequestException,
	Body,
	Controller,
	Get,
	Inject,
	HttpException,
	Post,
	Query,
	Req,
	Res
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { FastifyReply } from 'fastify';

import { AUTH_OPERATIONS, type AuthOperations } from '#services/auth.ts';
import { OBJECT_STORAGE, type ObjectStorage } from '#services/object-storage.ts';
import {
	STORAGE_QUOTA,
	StorageQuotaExceededError,
	type StorageQuotaStore
} from '#services/storage-quota.ts';

interface StorageItem {
	name: string;
	path: string;
	type: 'file' | 'directory';
	size: number;
	lastModified: string | null;
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

function validateFilePath(value: string | undefined): string {
	const path = value?.replaceAll('\\', '/');
	if (!path || path.startsWith('/') || path.split('/').some((part) => part === '..')) {
		throw new BadRequestException('A valid file path is required.');
	}
	return path;
}

function videoContentType(fileName: string): string | null {
	const extension = fileName.split('.').pop()?.toLowerCase();
	const types: Record<string, string> = {
		m4v: 'video/mp4',
		mov: 'video/quicktime',
		mp4: 'video/mp4',
		ogv: 'video/ogg',
		webm: 'video/webm'
	};
	return extension ? (types[extension] ?? null) : null;
}

function splitFileName(fileName: string): { base: string; extension: string } {
	const extensionIndex = fileName.lastIndexOf('.');
	if (extensionIndex <= 0) return { base: fileName, extension: '' };
	return {
		base: fileName.slice(0, extensionIndex),
		extension: fileName.slice(extensionIndex)
	};
}

function latestDate(current: string | null | undefined, next: Date | undefined): string | null {
	const nextValue = next?.toISOString();
	if (!nextValue) return current ?? null;
	if (!current || nextValue > current) return nextValue;
	return current;
}

async function getAvailableFileKey(
	storage: ObjectStorage,
	userId: string,
	path: string,
	fileName: string
): Promise<string> {
	const existingKeys = new Set((await storage.list(userId)).map((object) => object.key));
	const prefix = `${userId}/${path ? `${path}/` : ''}`;
	const { base, extension } = splitFileName(fileName);

	for (let suffix = 0; ; suffix += 1) {
		const candidateName = suffix === 0 ? fileName : `${base} (${suffix})${extension}`;
		const candidateKey = `${prefix}${candidateName}`;

		// Treat a matching directory as a collision too, so the UI cannot show
		// both a file and a directory with the same path.
		if (!existingKeys.has(candidateKey) && !existingKeys.has(`${candidateKey}/`)) {
			return candidateKey;
		}
	}
}

@Controller('api')
export class FilesController {
	constructor(
		@Inject(AUTH_OPERATIONS) private readonly auth: AuthOperations,
		@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
		@Inject(STORAGE_QUOTA) private readonly quota: StorageQuotaStore
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
					...(items.get(path) ?? {
						name: parts[index]!,
						path,
						type: isDirectory ? 'directory' : 'file',
						size: isDirectory ? 0 : object.size,
						lastModified: null
					}),
					type: isDirectory ? 'directory' : 'file',
					size: isDirectory ? 0 : object.size,
					lastModified: latestDate(
						items.get(path)?.lastModified,
						object.lastModified
					)
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
		const normalizedPath = validateFilePath(filePath);

		const key = `${user.userId}/${normalizedPath}`;
		const fileName = normalizedPath.split('/').pop() ?? 'download';
		const object = await this.storage.download(key);

		reply.header('Content-Type', 'application/octet-stream');
		reply.header(
			'Content-Disposition',
			`attachment; filename="${encodeURIComponent(fileName)}"`
		);
		reply.send(object.stream);
	}

	@Get('files/stream')
	async streamFile(
		@Query('path') filePath: string,
		@Req() request: FastifyRequest,
		@Res() reply: FastifyReply
	): Promise<void> {
		const user = await this.auth.requireUser(request);
		const normalizedPath = validateFilePath(filePath);
		const key = `${user.userId}/${normalizedPath}`;
		const fileName = normalizedPath.split('/').pop() ?? 'video';
		const object = await this.storage.download(key, request.headers.range);

		reply.header(
			'Content-Type',
			object.contentType ??
				videoContentType(fileName) ??
				'application/octet-stream'
		);
		reply.header('Accept-Ranges', 'bytes');
		reply.header('Content-Disposition', 'inline');
		if (object.contentLength !== undefined) {
			reply.header('Content-Length', object.contentLength);
		}
		if (object.contentRange) {
			reply.code(206).header('Content-Range', object.contentRange);
		}
		reply.send(object.stream);
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
		const key = await getAvailableFileKey(this.storage, user.userId, path, fileName);
		const expectedSizeHeader = request.headers['x-file-size'];
		if (typeof expectedSizeHeader !== 'string') {
			throw new BadRequestException('The uploaded file size is required.');
		}
		const expectedSize = Number(expectedSizeHeader);
		if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) {
			throw new BadRequestException('The uploaded file size is invalid.');
		}

		try {
			await this.quota.reserve(user.userId, expectedSize);
		} catch (error) {
			if (error instanceof StorageQuotaExceededError) {
				throw new HttpException('Storage quota exceeded.', 507);
			}
			throw error;
		}

		let actualSize = 0;
		const countedFile = new Transform({
			transform(chunk: Buffer, _encoding, callback) {
				actualSize += chunk.length;
				if (actualSize > expectedSize) {
					callback(
						new BadRequestException(
							'Uploaded file size does not match.'
						)
					);
					return;
				}
				callback(null, chunk);
			}
		});
		file.file.pipe(countedFile);

		try {
			await this.storage.upload(key, countedFile, file.mimetype);
			if (actualSize !== expectedSize) {
				throw new BadRequestException('Uploaded file size does not match.');
			}
		} catch (error) {
			await this.storage.delete(key).catch(() => undefined);
			await this.quota.release(user.userId, expectedSize);
			throw error;
		}

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
