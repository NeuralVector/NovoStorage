// This controller exposes the user's file-management API.
import { Transform } from 'node:stream';

import {
	BadRequestException,
	Body,
	Controller,
	Delete,
	Get,
	Inject,
	HttpException,
	NotFoundException,
	Post,
	Query,
	Req,
	Res
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { FastifyReply } from 'fastify';

import { AUTH_OPERATIONS, type AuthOperations } from '#services/auth.ts';
import { FILE_SHARING, type FileShareStore } from '#services/file-sharing.ts';
import {
	OBJECT_STORAGE,
	type ObjectStorage,
	type StorageObject
} from '#services/object-storage.ts';
import {
	STORAGE_QUOTA,
	StorageQuotaExceededError,
	type StorageQuotaStore
} from '#services/storage-quota.ts';
import { STORAGE_REFERENCES, type StorageReferenceStore } from '#services/storage-references.ts';
import { validateFilePath } from '#utils/storage-path.ts';

interface StorageItem {
	// This is the JSON shape consumed by the dashboard table. It hides provider-specific metadata
	// and gives directories the same predictable shape as files.
	name: string;
	path: string;
	type: 'file' | 'directory';
	size: number;
	lastModified: string | null;
	owner: string;
	referenceId?: string;
}

interface CreateDirectoryBody {
	// Both fields are optional at the request boundary and are validated before key construction.
	name?: string;
	parent?: string;
}

function validateRelativePath(value: string | undefined): string {
	// Folder upload paths are validated separately because an empty root is valid.
	const path =
		value
			?.trim()
			.replaceAll('\\', '/')
			.replace(/^\/+|\/+$/g, '') ?? '';
	// An empty value means the storage root here, unlike validateFilePath where a file is required.
	if (!path) return '';
	if (path.split('/').some((part) => !part || part === '.' || part === '..')) {
		throw new BadRequestException('A valid directory path is required.');
	}
	return path;
}

function videoContentType(fileName: string): string | null {
	// Use the extension only as a fallback because stored object metadata is preferred when available.
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
	// Keep the final extension attached when generating collision-safe names such as photo (1).jpg.
	const extensionIndex = fileName.lastIndexOf('.');
	if (extensionIndex <= 0) return { base: fileName, extension: '' };
	return {
		base: fileName.slice(0, extensionIndex),
		extension: fileName.slice(extensionIndex)
	};
}

function latestDate(current: string | null | undefined, next: Date | undefined): string | null {
	// Directory timestamps are derived from their newest descendant, so compare ISO strings consistently.
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
	// Find a unique filename before uploading so repeated uploads are not destructive. Both file and
	// directory-marker keys are checked because object storage permits same-name prefixes otherwise.
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
		// Inject abstractions so this controller contains HTTP policy, not S3/PostgreSQL details.
		@Inject(AUTH_OPERATIONS) private readonly auth: AuthOperations,
		@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
		@Inject(STORAGE_QUOTA) private readonly quota: StorageQuotaStore,
		@Inject(FILE_SHARING) private readonly shares: FileShareStore,
		@Inject(STORAGE_REFERENCES) private readonly references: StorageReferenceStore
	) {}

	@Get('files')
	async listFiles(@Req() request: FastifyRequest): Promise<StorageItem[]> {
		// Authenticate before listing any object keys.
		const user = await this.auth.requireUser(request);
		const objects = await this.storage.list(user.userId);
		const items = new Map<string, StorageItem>();
		const userPrefix = `${user.userId}/`;

		for (const object of objects) {
			// A single deep object implies every parent directory, so synthesize those rows for the UI.
			// Convert the provider's user-prefixed key into a path for the UI.
			const key = object.key;
			const relativeKey = key.startsWith(userPrefix)
				? key.slice(userPrefix.length)
				: key;
			const parts = relativeKey.split('/').filter(Boolean);

			for (let index = 0; index < parts.length; index += 1) {
				// Reusing the map entry merges duplicate parent paths from multiple descendants.
				const path = parts.slice(0, index + 1).join('/');
				const isDirectory =
					index < parts.length - 1 || relativeKey.endsWith('/');

				items.set(path, {
					...(items.get(path) ?? {
						name: parts[index]!,
						path,
						type: isDirectory ? 'directory' : 'file',
						size: isDirectory ? 0 : object.size,
						lastModified: null,
						owner: 'You'
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

		const references = await this.references.list(user.userId);
		// References belong to the recipient but their objects belong to another user.
		const ownerObjects = new Map<string, Map<string, StorageObject>>();
		const ownerIds = [...new Set(references.map((reference) => reference.ownerUserId))];
		await Promise.all(
			ownerIds.map(async (ownerId) => {
				// Fetch each distinct owner once; several recipient references may point to that owner.
				const ownerObjectMap = new Map(
					(await this.storage.list(ownerId)).map((object) => [
						object.key,
						object
					])
				);
				ownerObjects.set(ownerId, ownerObjectMap);
			})
		);
		const availableReferences = references.flatMap((reference) => {
			// A stale reference is omitted if its owner object has since been deleted.
			const object = ownerObjects
				.get(reference.ownerUserId)
				?.get(reference.objectKey);
			return object ? [{ reference, object }] : [];
		});

		if (availableReferences.length > 0) {
			const usedNames = new Set(items.keys());
			for (const { reference, object } of availableReferences) {
				// Shared names live beside owned names, so suffix collisions without altering the owner key.
				const { base, extension } = splitFileName(reference.name);
				let name = reference.name;
				for (let suffix = 1; usedNames.has(name); suffix += 1) {
					name = `${base} (${suffix})${extension}`;
				}
				usedNames.add(name);
				items.set(name, {
					name,
					path: name,
					type: 'file',
					size: object.size,
					lastModified:
						object.lastModified?.toISOString() ??
						reference.createdAt.toISOString(),
					owner: reference.ownerUserId,
					referenceId: reference.id
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
		@Query('referenceId') referenceId: string | undefined,
		@Req() request: FastifyRequest,
		@Res() reply: FastifyReply
	): Promise<void> {
		// A reference is resolved only if the current user owns that reference record; otherwise a path
		// is always interpreted inside the authenticated user's own prefix.
		const user = await this.auth.requireUser(request);
		const reference = referenceId
			? await this.references.getForUser(user.userId, referenceId)
			: null;
		if (referenceId && !reference) {
			throw new NotFoundException('Storage reference not found.');
		}
		const normalizedPath = reference ? null : validateFilePath(filePath);
		const key = reference ? reference.objectKey : `${user.userId}/${normalizedPath}`;
		const fileName = reference?.name ?? normalizedPath?.split('/').pop() ?? 'download';
		const object = await this.storage.download(key);

		// Downloads are attachments and use a generic content type because this endpoint is not preview-specific.
		reply.header('Content-Type', 'application/octet-stream');
		reply.header(
			'Content-Disposition',
			`attachment; filename="${encodeURIComponent(fileName)}"`
		);
		reply.send(object.stream);
	}

	@Delete('files')
	async deleteFile(
		@Query('path') filePath: string,
		@Query('referenceId') referenceId: string | undefined,
		@Req() request: FastifyRequest
	): Promise<{ deleted: number }> {
		// Deleting a reference removes access without deleting the owner's S3 object.
		const user = await this.auth.requireUser(request);
		if (referenceId) {
			const reference = await this.references.getForUser(
				user.userId,
				referenceId
			);
			if (!reference) throw new NotFoundException('Storage reference not found.');
			await this.references.revoke(user.userId, referenceId);
			return { deleted: 1 };
		}
		const normalizedPath = validateFilePath(filePath);
		const key = `${user.userId}/${normalizedPath}`;
		const directoryPrefix = `${key}/`;
		const objects = await this.storage.list(user.userId);
		const matchingObjects = objects.filter(
			// Include the exact key and every descendant when the requested item is a directory.
			(object) => object.key === key || object.key.startsWith(directoryPrefix)
		);

		if (matchingObjects.length === 0) {
			throw new NotFoundException('File or folder not found.');
		}

		await Promise.all(matchingObjects.map((object) => this.storage.delete(object.key)));
		// Only real file bytes count toward quota; zero-byte directory markers do not affect it.
		const releasedBytes = matchingObjects.reduce(
			(total, object) => total + object.size,
			0
		);
		if (releasedBytes > 0) {
			await this.quota.release(user.userId, releasedBytes);
		}
		await this.shares.revokeForPath(user.userId, normalizedPath);
		await Promise.all(
			// Removing an owner object also invalidates references pointing at that exact object.
			matchingObjects.map((object) =>
				this.references.revokeForObject(user.userId, object.key)
			)
		);

		return { deleted: matchingObjects.length };
	}

	@Get('files/stream')
	async streamFile(
		@Query('path') filePath: string,
		@Query('referenceId') referenceId: string | undefined,
		@Req() request: FastifyRequest,
		@Res() reply: FastifyReply
	): Promise<void> {
		// This endpoint streams video bytes and supports HTTP range requests, allowing native browser seeking.
		const user = await this.auth.requireUser(request);
		const reference = referenceId
			? await this.references.getForUser(user.userId, referenceId)
			: null;
		if (referenceId && !reference) {
			throw new NotFoundException('Storage reference not found.');
		}
		const normalizedPath = reference ? null : validateFilePath(filePath);
		const key = reference ? reference.objectKey : `${user.userId}/${normalizedPath}`;
		const fileName = reference?.name ?? normalizedPath?.split('/').pop() ?? 'video';
		const object = await this.storage.download(key, request.headers.range);

		// Forward range metadata so the browser can distinguish a partial 206 response from a full response.
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
		// Uploads are processed as streams so file size is not limited by RAM. The client-provided size is
		// used for reservation, while the Transform verifies that streamed bytes match it.
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
				// Count before forwarding each chunk so oversized streams are stopped immediately.
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
			// Reserve quota before sending data to S3; failed uploads release it below and remove partial data.
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
		// A directory is represented by an empty S3 object ending with a slash; its parent is validated
		// separately so the resulting key cannot contain traversal segments.
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
		// Writing the marker establishes the logical folder in an object store with no native directories.
		await this.storage.createDirectory(key);

		return { key };
	}
}
