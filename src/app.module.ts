// The root Nest module assembles controllers and shared providers.
import { Module } from '@nestjs/common';

import { DashboardController } from '#controllers/dashboard.ts';
import { FilesController } from '#controllers/files.ts';
import { LandingController } from '#controllers/landing.ts';
import { PublicShareController, ShareController } from '#controllers/shares.ts';
import { StorageController } from '#controllers/storage.ts';
import { ServicesModule } from '#services/services.module.ts';
import { PAGE_RENDERER, StaticPageRenderer } from '#utils/page-renderer.ts';

@Module({
	// AppModule is the composition root: it wires HTTP controllers to shared infrastructure providers.
	// ServicesModule contains authentication, database, quota and S3 services.
	imports: [ServicesModule],
	// Controllers turn HTTP requests into calls to the appropriate services.
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
