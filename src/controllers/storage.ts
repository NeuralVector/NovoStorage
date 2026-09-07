import { Controller, Get, Inject, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { AUTH_OPERATIONS, type AuthOperations } from '#services/auth.ts';
import { STORAGE_QUOTA, type StorageQuotaStore } from '#services/storage-quota.ts';

@Controller('api/storage')
export class StorageController {
	constructor(
		@Inject(AUTH_OPERATIONS) private readonly auth: AuthOperations,
		@Inject(STORAGE_QUOTA) private readonly quota: StorageQuotaStore
	) {}

	@Get('usage')
	async getUsage(@Req() request: FastifyRequest) {
		const user = await this.auth.requireUser(request);
		const usage = await this.quota.getUsage(user.userId);
		return {
			...usage,
			remainingBytes: Math.max(usage.quotaBytes - usage.usedBytes, 0)
		};
	}
}
