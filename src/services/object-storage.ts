// ObjectStorage hides the storage provider from controllers and services.
// Its stream-based methods allow large files to avoid being loaded in memory.
import type { Readable } from 'node:stream';

export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

export interface StorageObject {
	// This metadata is the provider-neutral representation used by quota and controller code.
	key: string;
	size: number;
	lastModified?: Date;
}

export interface DownloadedObject {
	// A download exposes a stream plus optional HTTP metadata needed for efficient responses.
	stream: Readable;
	contentLength?: number;
	contentType?: string;
	contentRange?: string;
}

export interface ObjectStorage {
	// Upload accepts a Buffer or stream so small and large files use the same abstraction.
	upload(key: string, body: Buffer | Readable, contentType?: string): Promise<void>;
	// Deleting a key is separate from deleting a logical folder, which the controller expands to keys.
	delete(key: string): Promise<void>;
	// Directory markers are a UI convention implemented by the concrete object store.
	createDirectory(key: string): Promise<void>;
	// List is scoped by user ID so implementations enforce tenant isolation at the storage boundary.
	list(userId: string): Promise<StorageObject[]>;
	// Optional range input allows media elements to seek without downloading the entire object.
	download(key: string, range?: string): Promise<DownloadedObject>;
}
