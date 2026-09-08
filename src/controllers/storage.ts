import { Controller, Get, Inject, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

import { AUTH_OPERATIONS, type AuthOperations } from '#services/auth.ts';
import { STORAGE_QUOTA, type StorageQuotaStore } from '#services/storage-quota.ts';

// This controller exposes accounting separately from file listing so the dashboard can refresh it cheaply.
@Controller('api/storage')
export class StorageController {
	constructor(
		@Inject(AUTH_OPERATIONS) private readonly auth: AuthOperations,
		@Inject(STORAGE_QUOTA) private readonly quota: StorageQuotaStore
	) {}

	@Get('usage')
	async getUsage(@Req() request: FastifyRequest) {
		// Authentication scopes the quota lookup to the current Clerk user.
		const user = await this.auth.requireUser(request);
		const usage = await this.quota.getUsage(user.userId);
		// Never report negative free space even if a legacy counter briefly exceeds its configured quota.
		return {
			...usage,
			remainingBytes: Math.max(usage.quotaBytes - usage.usedBytes, 0)
		};
	}
}
