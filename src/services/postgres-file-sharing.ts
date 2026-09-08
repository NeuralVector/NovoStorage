// PostgreSQL implementation of the file-sharing abstraction.
import { randomBytes } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { Pool } from 'pg';

import type { FileShare, FileShareStore } from '#services/file-sharing.ts';
import { POSTGRES_POOL } from '#services/postgres-storage-quota.ts';

@Injectable()
export class PostgresFileShareStore implements FileShareStore, OnModuleInit {
	constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

	async onModuleInit(): Promise<void> {
		// Tables and indexes are created when the application starts.
		await this.pool.query(`
			CREATE TABLE IF NOT EXISTS file_shares (
				token TEXT PRIMARY KEY,
				user_id TEXT NOT NULL,
				path TEXT NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				revoked_at TIMESTAMPTZ
			)
		`);
		await this.pool.query(`
			CREATE INDEX IF NOT EXISTS file_shares_user_id_idx
			ON file_shares (user_id)
			WHERE revoked_at IS NULL
		`);
	}

	async create(userId: string, path: string): Promise<FileShare> {
		// A cryptographically random token makes the public link difficult to guess.
		for (;;) {
			// The loop is practically one iteration; it handles the vanishingly unlikely token collision.
			const token = randomBytes(32).toString('base64url');
			const result = await this.pool.query<{
				token: string;
				user_id: string;
				path: string;
				created_at: Date;
			}>(
				`INSERT INTO file_shares (token, user_id, path)
				 VALUES ($1, $2, $3)
				 ON CONFLICT (token) DO NOTHING
				 RETURNING token, user_id, path, created_at`,
				[token, userId, path]
			);

			const row = result.rows[0];
			if (row) return this.toShare(row);
		}
	}

	async get(token: string): Promise<FileShare | null> {
		// Revoked shares are intentionally invisible to callers.
		const result = await this.pool.query<{
			token: string;
			user_id: string;
			path: string;
			created_at: Date;
		}>(
			`SELECT token, user_id, path, created_at
			 FROM file_shares
			 WHERE token = $1 AND revoked_at IS NULL`,
			[token]
		);
		const row = result.rows[0];
		return row ? this.toShare(row) : null;
	}

	async list(userId: string): Promise<FileShare[]> {
		// Return newest active links first so the owner sees recently-created shares immediately.
		const result = await this.pool.query<{
			token: string;
			user_id: string;
			path: string;
			created_at: Date;
		}>(
			`SELECT token, user_id, path, created_at
			 FROM file_shares
			 WHERE user_id = $1 AND revoked_at IS NULL
			 ORDER BY created_at DESC`,
			[userId]
		);
		return result.rows.map((row) => this.toShare(row));
	}

	async revoke(userId: string, token: string): Promise<void> {
		// Soft deletion keeps audit history while making the token unusable.
		await this.pool.query(
			`UPDATE file_shares
			 SET revoked_at = NOW()
			 WHERE user_id = $1 AND token = $2 AND revoked_at IS NULL`,
			[userId, token]
		);
	}

	async revokeForPath(userId: string, path: string): Promise<void> {
		// Escape LIKE metacharacters so a literal filename cannot revoke unrelated shares.
		const escapedPath = path
			.replaceAll('\\', '\\\\')
			.replaceAll('%', '\\%')
			.replaceAll('_', '\\_');
		await this.pool.query(
			`UPDATE file_shares
			 SET revoked_at = NOW()
			 WHERE user_id = $1
			   AND revoked_at IS NULL
			   AND (path = $2 OR path LIKE $3 ESCAPE E'\\\\')`,
			[userId, path, `${escapedPath}/%`]
		);
	}

	private toShare(row: {
		token: string;
		user_id: string;
		path: string;
		created_at: Date;
	}): FileShare {
		return {
			token: row.token,
			userId: row.user_id,
			path: row.path,
			createdAt: row.created_at
		};
	}
}
