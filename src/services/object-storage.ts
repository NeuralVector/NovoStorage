import type { Readable } from 'node:stream';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export interface ObjectStorage {
	upload(key: string, body: Buffer, contentType?: string): Promise<void>;
	list(userId: string): Promise<string[]>;
	download(key: string): Promise<Readable>;
}
