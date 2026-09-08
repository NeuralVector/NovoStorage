// A share is a revocable link that can be accepted into another user's storage.
export const FILE_SHARING = Symbol('FILE_SHARING');

export interface FileShare {
	// A share is metadata for a public token; the file itself remains in object storage.
	token: string;
	userId: string;
	path: string;
	createdAt: Date;
}

export interface FileShareStore {
	// Store implementations own token generation, persistence, and revocation semantics.
	create(userId: string, path: string): Promise<FileShare>;
	get(token: string): Promise<FileShare | null>;
	list(userId: string): Promise<FileShare[]>;
	revoke(userId: string, token: string): Promise<void>;
	revokeForPath(userId: string, path: string): Promise<void>;
}
