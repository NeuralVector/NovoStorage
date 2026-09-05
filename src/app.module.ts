import { Module } from '@nestjs/common';

import { AUTH_OPERATIONS, ClerkAuthOperations } from '#auth/auth.ts';
import { DashboardController } from '#controllers/dashboard.ts';
import { LandingController } from '#controllers/landing.ts';
import { PAGE_RENDERER, StaticPageRenderer } from '#utils/page-renderer.ts';

@Module({
	controllers: [DashboardController, LandingController],
	providers: [
		{
			provide: AUTH_OPERATIONS,
			useClass: ClerkAuthOperations
		},
		{
			provide: PAGE_RENDERER,
			useClass: StaticPageRenderer
		}
	]
})
export class AppModule {}
