import type { Readable } from 'node:stream';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export interface StorageObject {
	key: string;
	size: number;
}

export interface ObjectStorage {
	upload(key: string, body: Buffer | Readable, contentType?: string): Promise<void>;
	createDirectory(key: string): Promise<void>;
	list(userId: string): Promise<StorageObject[]>;
	download(key: string): Promise<Readable>;
}
