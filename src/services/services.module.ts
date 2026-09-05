import { Module } from '@nestjs/common';

import { AUTH_OPERATIONS, ClerkAuthOperations } from '#services/auth.ts';
import { s3ClientProvider } from '#services/s3.ts';

@Module({
	providers: [
		{
			provide: AUTH_OPERATIONS,
			useClass: ClerkAuthOperations
		},
		s3ClientProvider
	],
	exports: [AUTH_OPERATIONS, s3ClientProvider]
})
export class ServicesModule {}
