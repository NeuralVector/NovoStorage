import { Module } from '@nestjs/common';

import { AUTH_OPERATIONS, ClerkAuthOperations } from '#services/auth.ts';
import { OBJECT_STORAGE } from '#services/object-storage.ts';
import { S3ObjectStorage, s3ClientProvider } from '#services/s3.ts';

@Module({
	providers: [
		{
			provide: AUTH_OPERATIONS,
			useClass: ClerkAuthOperations
		},
		s3ClientProvider,
		{
			provide: OBJECT_STORAGE,
			useClass: S3ObjectStorage
		}
	],
	exports: [AUTH_OPERATIONS, OBJECT_STORAGE]
})
export class ServicesModule {}
