// This adapter translates the generic ObjectStorage interface into S3 commands.
import { Readable } from 'node:stream';

import {
	GetObjectCommand,
	ListObjectsV2Command,
	DeleteObjectCommand,
	PutObjectCommand,
	S3Client
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Inject, Injectable } from '@nestjs/common';

import config from '#config';
import type { DownloadedObject, ObjectStorage, StorageObject } from '#services/object-storage.ts';

export const s3ClientProvider = {
	// Nest creates one shared S3 client and injects it where needed.
	provide: S3Client,
	useFactory: (): S3Client =>
		// The configured endpoint supports S3-compatible providers as well as AWS S3.
		new S3Client({
			region: config.get('storage.s3.region'),
			endpoint: config.get('storage.s3.endpoint'),
			// Some mobile hotspots advertise IPv6 without providing a usable route.
			// Backblaze remains reachable over IPv4 in that environment.
			requestHandler: {
				httpsAgent: { family: 4 }
			},
			credentials: {
				accessKeyId: config.get('storage.s3.accessKeyId'),
				secretAccessKey: config.get('storage.s3.secretAccessKey')
			}
		})
};

@Injectable()
export class S3ObjectStorage implements ObjectStorage {
	constructor(@Inject(S3Client) private readonly client: S3Client) {}

	async upload(key: string, body: Buffer | Readable, contentType?: string): Promise<void> {
		// Upload supports both small buffers and large readable streams. Multipart settings bound
		// concurrency and ensure failed multipart uploads are cleaned up.
		const upload = new Upload({
			client: this.client,
			params: {
				Bucket: config.get('storage.s3.bucket'),
				Key: key,
				Body: body,
				...(contentType ? { ContentType: contentType } : {})
			},
			partSize: 10 * 1024 * 1024,
			queueSize: 2,
			leavePartsOnError: false
		});

		await upload.done();
	}

	async delete(key: string): Promise<void> {
		// S3 treats a directory as a key prefix, so deleting a file is one command.
		await this.client.send(
			new DeleteObjectCommand({
				Bucket: config.get('storage.s3.bucket'),
				Key: key
			})
		);
	}

	async createDirectory(key: string): Promise<void> {
		// Object storage has no real directories; an empty key ending in / acts as one.
		await this.client.send(
			new PutObjectCommand({
				Bucket: config.get('storage.s3.bucket'),
				Key: key,
				Body: Buffer.alloc(0)
			})
		);
	}

	async list(userId: string): Promise<StorageObject[]> {
		// Prefixing every key with the user ID prevents users from seeing each other's data.
		const objects: StorageObject[] = [];
		let continuationToken: string | undefined;

		do {
			// S3 may paginate results, so keep requesting pages until no token remains.
			const result = await this.client.send(
				new ListObjectsV2Command({
					Bucket: config.get('storage.s3.bucket'),
					Prefix: `${userId}/`,
					...(continuationToken
						? { ContinuationToken: continuationToken }
						: {})
				})
			);

			objects.push(
				// Ignore provider entries without keys because they cannot be addressed later.
				...(result.Contents?.flatMap((object) =>
					object.Key
						? [
								{
									key: object.Key,
									size: object.Size ?? 0,
									...(object.LastModified
										? {
												lastModified:
													object.LastModified
											}
										: {})
								}
							]
						: []
				) ?? [])
			);
			continuationToken = result.NextContinuationToken;
		} while (continuationToken);

		return objects;
	}

	async download(key: string, range?: string): Promise<DownloadedObject> {
		// Range requests are important for browser video playback and large downloads.
		const result = await this.client.send(
			new GetObjectCommand({
				Bucket: config.get('storage.s3.bucket'),
				Key: key,
				...(range ? { Range: range } : {})
			})
		);

		if (!result.Body) {
			throw new Error(`S3 object has no body: ${key}`);
		}

		return {
			// Convert the SDK body into a Node stream and preserve response metadata for HTTP callers.
			stream: Readable.from(result.Body as AsyncIterable<Uint8Array>),
			...(result.ContentLength !== undefined
				? { contentLength: result.ContentLength }
				: {}),
			...(result.ContentType ? { contentType: result.ContentType } : {}),
			...(result.ContentRange ? { contentRange: result.ContentRange } : {})
		};
	}
}
