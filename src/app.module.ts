import { Module } from '@nestjs/common';

import { DashboardController } from '#controllers/dashboard.ts';
import { FilesController } from '#controllers/files.ts';
import { LandingController } from '#controllers/landing.ts';
import { PublicShareController, ShareController } from '#controllers/shares.ts';
import { StorageController } from '#controllers/storage.ts';
import { ServicesModule } from '#services/services.module.ts';
import { PAGE_RENDERER, StaticPageRenderer } from '#utils/page-renderer.ts';

@Module({
	imports: [ServicesModule],
	controllers: [
		DashboardController,
		FilesController,
		LandingController,
		StorageController,
		ShareController,
		PublicShareController
	],
	providers: [
		{
			provide: PAGE_RENDERER,
			useClass: StaticPageRenderer
		}
	]
})
export class AppModule {}
