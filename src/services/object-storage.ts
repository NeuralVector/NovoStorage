export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export interface ObjectStorage {
	upload(key: string, body: Buffer, contentType?: string): Promise<void>;
	list(userId: string): Promise<string[]>;
}
