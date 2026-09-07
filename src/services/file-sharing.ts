export const FILE_SHARING = Symbol('FILE_SHARING');

export interface FileShare {
	token: string;
	userId: string;
	path: string;
	createdAt: Date;
}

export interface FileShareStore {
	create(userId: string, path: string): Promise<FileShare>;
	get(token: string): Promise<FileShare | null>;
	list(userId: string): Promise<FileShare[]>;
	revoke(userId: string, token: string): Promise<void>;
	revokeForPath(userId: string, path: string): Promise<void>;
}
