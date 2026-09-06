import { Readable } from 'node:stream';

import {
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Inject, Injectable } from '@nestjs/common';

import config from '#config';
import type { ObjectStorage, StorageObject } from '#services/object-storage.ts';

export const s3ClientProvider = {
	provide: S3Client,
	useFactory: (): S3Client =>
		new S3Client({
			region: config.get('storage.s3.region'),
			endpoint: config.get('storage.s3.endpoint'),
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

	async createDirectory(key: string): Promise<void> {
		await this.client.send(
			new PutObjectCommand({
				Bucket: config.get('storage.s3.bucket'),
				Key: key,
				Body: Buffer.alloc(0)
			})
		);
	}

	async list(userId: string): Promise<StorageObject[]> {
		const objects: StorageObject[] = [];
		let continuationToken: string | undefined;

		do {
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

	async download(key: string): Promise<Readable> {
		const result = await this.client.send(
			new GetObjectCommand({
				Bucket: config.get('storage.s3.bucket'),
				Key: key
			})
		);

		if (!result.Body) {
			throw new Error(`S3 object has no body: ${key}`);
		}

		return Readable.from(result.Body as AsyncIterable<Uint8Array>);
	}
}
