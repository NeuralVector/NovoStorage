import { S3Client } from '@aws-sdk/client-s3';

import config from '#config';

export const s3ClientProvider = {
	provide: S3Client,
	useFactory: (): S3Client =>
		new S3Client({
			region: config.get('storage.s3.region'),
			endpoint: config.get('storage.s3.endpoint'),
			credentials: {
				accessKeyId: config.get('storage.s3.accessKeyId'),
				secretAccessKey: config.get('storage.s3.secretAccessKey')
			}
		})
};
