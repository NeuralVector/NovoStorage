import { Module } from '@nestjs/common';

import { LandingController } from './controllers/landing.ts';
import { PAGE_RENDERER, StaticPageRenderer } from './utils/page-renderer.ts';

@Module({
	controllers: [LandingController],
	providers: [
		{
			provide: PAGE_RENDERER,
			useClass: StaticPageRenderer
		}
	]
})
export class AppModule {}
