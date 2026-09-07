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
		await this.pool.end();
	}

	async getUsage(userId: string): Promise<StorageUsage> {
		const row = await this.withInitializedUser(userId, async (_client, user) => user);
		return this.toUsage(row.used_bytes);
	}

	async reserve(userId: string, bytes: number): Promise<StorageUsage> {
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
		return {
			usedBytes: Number(usedBytes),
			quotaBytes: config.get('storage.quotaBytes')
		};
	}

	private validateBytes(bytes: number): void {
		if (!Number.isSafeInteger(bytes) || bytes < 0) {
			throw new Error('Storage byte count must be a non-negative safe integer.');
		}
	}
}
