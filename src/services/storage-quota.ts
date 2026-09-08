// Controllers depend on this token and interface, not directly on PostgreSQL.
export const STORAGE_QUOTA = Symbol('STORAGE_QUOTA');

export interface StorageUsage {
	// Quota storage returns only accounting data; the UI derives percentages and labels.
	usedBytes: number;
	quotaBytes: number;
}

export class StorageQuotaExceededError extends Error {
	constructor() {
		// A distinct error type lets the HTTP layer map quota exhaustion to status 507.
		super('Storage quota exceeded.');
		this.name = 'StorageQuotaExceededError';
	}
}

export interface StorageQuotaStore {
	// Reserve/release are separate operations so failed streams can roll back their reservation.
	getUsage(userId: string): Promise<StorageUsage>;
	reserve(userId: string, bytes: number): Promise<StorageUsage>;
	release(userId: string, bytes: number): Promise<StorageUsage>;
}
