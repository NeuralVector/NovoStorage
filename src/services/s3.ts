import { Readable } from 'node:stream';

import {
	GetObjectCommand,
	ListObjectsV2Command,
	PutObjectCommand,
	S3Client
} from '@aws-sdk/client-s3';
import { Injectable } from '@nestjs/common';

import config from '#config';
import type { ObjectStorage } from '#services/object-storage.ts';

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
	constructor(private readonly client: S3Client) {}

	async upload(key: string, body: Buffer, contentType?: string): Promise<void> {
		const command = new PutObjectCommand({
			Bucket: config.get('storage.s3.bucket'),
			Key: key,
			Body: body,
			...(contentType ? { ContentType: contentType } : {})
		});

		await this.client.send(command);
	}

	async list(userId: string): Promise<string[]> {
		const result = await this.client.send(
			new ListObjectsV2Command({
				Bucket: config.get('storage.s3.bucket'),
				Prefix: `${userId}/`
			})
		);

		return result.Contents?.flatMap((object) => (object.Key ? [object.Key] : [])) ?? [];
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
