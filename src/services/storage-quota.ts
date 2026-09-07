export const STORAGE_QUOTA = Symbol('STORAGE_QUOTA');

export interface StorageUsage {
	usedBytes: number;
	quotaBytes: number;
}

export class StorageQuotaExceededError extends Error {
	constructor() {
		super('Storage quota exceeded.');
		this.name = 'StorageQuotaExceededError';
	}
}

export interface StorageQuotaStore {
	getUsage(userId: string): Promise<StorageUsage>;
	reserve(userId: string, bytes: number): Promise<StorageUsage>;
	release(userId: string, bytes: number): Promise<StorageUsage>;
}
