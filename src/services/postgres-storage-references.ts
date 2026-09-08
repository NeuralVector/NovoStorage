// PostgreSQL implementation for virtual shared-file references.
import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import type { Pool } from 'pg';

import { POSTGRES_POOL } from '#services/postgres-storage-quota.ts';
import type { StorageReference, StorageReferenceStore } from '#services/storage-references.ts';

@Injectable()
export class PostgresStorageReferenceStore implements StorageReferenceStore, OnModuleInit {
	constructor(@Inject(POSTGRES_POOL) private readonly pool: Pool) {}

	async onModuleInit(): Promise<void> {
		// The reference table stores permission and pointer metadata, not file bytes.
		await this.pool.query(`
			CREATE TABLE IF NOT EXISTS storage_references (
				id TEXT PRIMARY KEY,
				owner_user_id TEXT NOT NULL,
				recipient_user_id TEXT NOT NULL,
				object_key TEXT NOT NULL,
				name TEXT NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
				revoked_at TIMESTAMPTZ
			)
		`);
		await this.pool.query(`
			CREATE UNIQUE INDEX IF NOT EXISTS storage_references_active_idx
			ON storage_references (recipient_user_id, object_key)
			WHERE revoked_at IS NULL
		`);
		await this.pool.query(`
			CREATE INDEX IF NOT EXISTS storage_references_recipient_idx
			ON storage_references (recipient_user_id)
			WHERE revoked_at IS NULL
		`);
	}

	async create(
		recipientUserId: string,
		ownerUserId: string,
		objectKey: string,
		name: string
	): Promise<StorageReference> {
		// Do not create duplicate active references for the same recipient and object; the unique
		// partial index is the final race-safe enforcement when two accepts happen together.
		const existing = await this.pool.query<StorageReferenceRow>(
			`SELECT id, owner_user_id, recipient_user_id, object_key, name, created_at
			 FROM storage_references
			 WHERE recipient_user_id = $1
			   AND object_key = $2
			   AND revoked_at IS NULL`,
			[recipientUserId, objectKey]
		);
		if (existing.rows[0]) return this.toReference(existing.rows[0]);

		const result = await this.pool.query<StorageReferenceRow>(
			`INSERT INTO storage_references
				(id, owner_user_id, recipient_user_id, object_key, name)
			 VALUES ($1, $2, $3, $4, $5)
			 ON CONFLICT DO NOTHING
			 RETURNING id, owner_user_id, recipient_user_id, object_key, name, created_at`,
			[randomUUID(), ownerUserId, recipientUserId, objectKey, name]
		);

		const row = result.rows[0];
		if (row) return this.toReference(row);
		return this.create(recipientUserId, ownerUserId, objectKey, name);
	}

	async list(recipientUserId: string): Promise<StorageReference[]> {
		// Recipients see only active references addressed to their own user ID.
		// Only active references belonging to this recipient are returned.
		const result = await this.pool.query<StorageReferenceRow>(
			`SELECT id, owner_user_id, recipient_user_id, object_key, name, created_at
			 FROM storage_references
			 WHERE recipient_user_id = $1 AND revoked_at IS NULL
			 ORDER BY created_at DESC`,
			[recipientUserId]
		);
		return result.rows.map((row) => this.toReference(row));
	}

	async getForUser(recipientUserId: string, id: string): Promise<StorageReference | null> {
		// Combining recipient and ID prevents a user from probing another user's reference record.
		const result = await this.pool.query<StorageReferenceRow>(
			`SELECT id, owner_user_id, recipient_user_id, object_key, name, created_at
			 FROM storage_references
			 WHERE id = $1 AND recipient_user_id = $2 AND revoked_at IS NULL`,
			[id, recipientUserId]
		);
		const row = result.rows[0];
		return row ? this.toReference(row) : null;
	}

	async revoke(recipientUserId: string, id: string): Promise<void> {
		// Revocation is a soft delete so owner metadata can remain auditable.
		await this.pool.query(
			`UPDATE storage_references
			 SET revoked_at = NOW()
			 WHERE id = $1 AND recipient_user_id = $2 AND revoked_at IS NULL`,
			[id, recipientUserId]
		);
	}

	async revokeForObject(ownerUserId: string, objectKey: string): Promise<void> {
		// Owner deletion invalidates every recipient pointer to that exact object.
		await this.pool.query(
			`UPDATE storage_references
			 SET revoked_at = NOW()
			 WHERE owner_user_id = $1 AND object_key = $2 AND revoked_at IS NULL`,
			[ownerUserId, objectKey]
		);
	}

	private toReference(row: StorageReferenceRow): StorageReference {
		return {
			id: row.id,
			ownerUserId: row.owner_user_id,
			recipientUserId: row.recipient_user_id,
			objectKey: row.object_key,
			name: row.name,
			createdAt: row.created_at
		};
	}
}

interface StorageReferenceRow {
	id: string;
	owner_user_id: string;
	recipient_user_id: string;
	object_key: string;
	name: string;
	created_at: Date;
}
