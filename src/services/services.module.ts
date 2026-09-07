import { Module } from '@nestjs/common';

import { AUTH_OPERATIONS, ClerkAuthOperations } from '#services/auth.ts';
import { FILE_SHARING } from '#services/file-sharing.ts';
import { OBJECT_STORAGE } from '#services/object-storage.ts';
import { PostgresFileShareStore } from '#services/postgres-file-sharing.ts';
import { PostgresStorageQuota, postgresPoolProvider } from '#services/postgres-storage-quota.ts';
import { S3ObjectStorage, s3ClientProvider } from '#services/s3.ts';
import { STORAGE_QUOTA } from '#services/storage-quota.ts';

@Module({
	providers: [
		{
			provide: AUTH_OPERATIONS,
			useClass: ClerkAuthOperations
		},
		s3ClientProvider,
		postgresPoolProvider,
		{
			provide: STORAGE_QUOTA,
			useClass: PostgresStorageQuota
		},
		{
			provide: OBJECT_STORAGE,
			useClass: S3ObjectStorage
		},
		{
			provide: FILE_SHARING,
			useClass: PostgresFileShareStore
		}
	],
	exports: [AUTH_OPERATIONS, OBJECT_STORAGE, STORAGE_QUOTA, FILE_SHARING]
})
export class ServicesModule {}
