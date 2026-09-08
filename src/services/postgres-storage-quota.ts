// PostgreSQL stores quota counters while ObjectStorage stores the actual bytes.
import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';

import config from '#config';
import { OBJECT_STORAGE, type ObjectStorage } from '#services/object-storage.ts';
import {
	StorageQuotaExceededError,
	type StorageQuotaStore,
	type StorageUsage
} from '#services/storage-quota.ts';

export const POSTGRES_POOL = Symbol('POSTGRES_POOL');

export const postgresPoolProvider = {
	// A pool reuses database connections across requests and is shared by all PostgreSQL-backed stores.
	provide: POSTGRES_POOL,
	useFactory: (): Pool =>
		new Pool({
			connectionString: config.get('database.url')
		})
};

@Injectable()
export class PostgresStorageQuota implements StorageQuotaStore, OnModuleInit, OnModuleDestroy {
	constructor(
		@Inject(POSTGRES_POOL) private readonly pool: Pool,
		@Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage
	) {}

	async onModuleInit(): Promise<void> {
		// Create the quota table when the service starts.
		await this.pool.query(`
			CREATE TABLE IF NOT EXISTS storage_usage (
				user_id TEXT PRIMARY KEY,
				used_bytes BIGINT NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
				initialized BOOLEAN NOT NULL DEFAULT FALSE,
				updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
			)
		`);
		await this.pool.query(`
			ALTER TABLE storage_usage
			ADD COLUMN IF NOT EXISTS initialized BOOLEAN NOT NULL DEFAULT FALSE
		`);
	}

	async onModuleDestroy(): Promise<void> {
		// Close idle and active database connections during graceful application shutdown.
		await this.pool.end();
	}

	async getUsage(userId: string): Promise<StorageUsage> {
		// The first lookup reconciles the counter with existing S3 objects.
		const row = await this.withInitializedUser(userId, async (_client, user) => user);
		return this.toUsage(row.used_bytes);
	}

	async reserve(userId: string, bytes: number): Promise<StorageUsage> {
		// Reserve space before uploading so an upload cannot exceed the quota.
		this.validateBytes(bytes);
		const row = await this.withInitializedUser(userId, async (client) => {
			const result = await client.query<{ used_bytes: string }>(
				`UPDATE storage_usage
				 SET used_bytes = used_bytes + $2, updated_at = NOW()
				 WHERE user_id = $1
				   AND used_bytes + $2 <= $3
				 RETURNING used_bytes`,
				[userId, bytes, config.get('storage.quotaBytes')]
			);

			const row = result.rows[0];
			if (!row) throw new StorageQuotaExceededError();
			return row;
		});
		return this.toUsage(row.used_bytes);
	}

	async release(userId: string, bytes: number): Promise<StorageUsage> {
		// Clamp at zero so retries or recovery after a partial failure cannot create negative usage.
		this.validateBytes(bytes);
		const result = await this.pool.query<{ used_bytes: string }>(
			`UPDATE storage_usage
			 SET used_bytes = GREATEST(used_bytes - $2, 0), updated_at = NOW()
			 WHERE user_id = $1
			 RETURNING used_bytes`,
			[userId, bytes]
		);

		const row = result.rows[0] ?? (await this.ensureUser(userId));
		return this.toUsage(row.used_bytes);
	}

	private async ensureUser(userId: string): Promise<{ used_bytes: string }> {
		// Create a zeroed row for users who release before any successful reservation exists.
		const result = await this.pool.query<{ used_bytes: string }>(
			`INSERT INTO storage_usage (user_id, initialized)
			 VALUES ($1, TRUE)
			 ON CONFLICT (user_id) DO NOTHING
			 RETURNING used_bytes`,
			[userId]
		);
		return result.rows[0] ?? { used_bytes: '0' };
	}

	private async withInitializedUser<T>(
		userId: string,
		callback: (
			client: PoolClient,
			user: { used_bytes: string; initialized: boolean }
		) => Promise<T>
	): Promise<T> {
		// Lock this user's row so simultaneous uploads update quota safely. The transaction also keeps
		// first-use reconciliation and the subsequent reservation atomic.
		const client = await this.pool.connect();
		try {
			await client.query('BEGIN');
			await client.query(
				`INSERT INTO storage_usage (user_id)
				 VALUES ($1)
				 ON CONFLICT (user_id) DO NOTHING`,
				[userId]
			);
			const result = await client.query<{
				used_bytes: string;
				initialized: boolean;
			}>(
				`SELECT used_bytes, initialized
				 FROM storage_usage
				 WHERE user_id = $1
				 FOR UPDATE`,
				[userId]
			);
			const user = result.rows[0]!;

			if (!user.initialized) {
				// Reconcile legacy/external objects once before trusting the counter.
				const objects = await this.storage.list(userId);
				const usedBytes = objects.reduce(
					(total, object) => total + object.size,
					0
				);
				await client.query(
					`UPDATE storage_usage
					 SET used_bytes = $2, initialized = TRUE, updated_at = NOW()
					 WHERE user_id = $1`,
					[userId, usedBytes]
				);
				user.used_bytes = String(usedBytes);
				user.initialized = true;
			}

			const resultValue = await callback(client, user);
			await client.query('COMMIT');
			return resultValue;
		} catch (error) {
			await client.query('ROLLBACK');
			throw error;
		} finally {
			client.release();
		}
	}

	private toUsage(usedBytes: string): StorageUsage {
		// PostgreSQL BIGINT values arrive as strings in node-postgres to avoid precision loss.
		return {
			usedBytes: Number(usedBytes),
			quotaBytes: config.get('storage.quotaBytes')
		};
	}

	private validateBytes(bytes: number): void {
		// Reject values that could break accounting or exceed JavaScript's exact integer range.
		if (!Number.isSafeInteger(bytes) || bytes < 0) {
			throw new Error('Storage byte count must be a non-negative safe integer.');
		}
	}
}
