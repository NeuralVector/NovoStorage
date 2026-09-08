// Centralized application configuration.
// Convict reads environment variables and validates their expected formats.
import convict from 'convict';

// Other files import this object instead of reading process.env everywhere.
const config = convict({
	// Convict maps each documented option to an environment variable and validates it at startup.
	env: {
		doc: 'Application environment',
		format: ['development', 'production', 'test'],
		default: 'development',
		env: 'NODE_ENV'
	},

	server: {
		// Host/port are kept together because they define where the HTTP listener binds.
		host: {
			doc: 'Server bind address',
			format: String,
			default: 'localhost',
			env: 'HOST'
		},

		port: {
			doc: 'Server port',
			format: 'port',
			default: 3000,
			env: 'PORT'
		}
	},

	clerk: {
		// Clerk owns browser authentication; this URL is the safe external handoff destination.
		accountPortalUrl: {
			doc: 'Clerk Account Portal URL',
			format: (value: unknown) => {
				if (typeof value !== 'string' || value.trim() === '') {
					throw new Error('CLERK_ACCOUNT_PORTAL_URL is required');
				}
			},
			default: 'https://present-alien-4948.accounts.dev',
			env: 'CLERK_ACCOUNT_PORTAL_URL'
		}
	},

	website: {
		// Absolute public URLs are used when generating redirects and share links.
		url: {
			doc: 'Public website URL',
			format: String,
			default: 'http://localhost',
			env: 'WEBSITE_URL'
		}
	},

	database: {
		// PostgreSQL stores metadata, quota counters, shares, and virtual references.
		url: {
			doc: 'PostgreSQL connection URL',
			format: String,
			default: 'postgresql://novostorage:novostorage@localhost:5432/novostorage',
			env: 'POSTGRES_URL'
		}
	},

	storage: {
		// Quota is an accounting limit; object bytes live in the configured S3-compatible service.
		quotaBytes: {
			doc: 'Maximum storage space per user in bytes',
			format: 'nat',
			default: 10 * 1024 ** 3,
			env: 'STORAGE_QUOTA_BYTES'
		},
		s3: {
			region: {
				doc: 'AWS S3 region',
				format: String,
				default: 'ap-south-1',
				env: 'S3_REGION'
			},
			endpoint: {
				doc: 'S3 endpoint',
				format: (value: unknown) => {
					if (typeof value !== 'string' || value.trim() === '') {
						throw new Error('S3_ENDPOINT is required');
					}
				},
				default: '',
				env: 'S3_ENDPOINT'
			},
			bucket: {
				doc: 'S3 bucket name',
				format: (value: unknown) => {
					if (typeof value !== 'string' || value.trim() === '') {
						throw new Error('S3_BUCKET is required');
					}
				},
				default: '',
				env: 'S3_BUCKET'
			},
			accessKeyId: {
				doc: 'S3 access key ID',
				format: (value: unknown) => {
					if (typeof value !== 'string' || value.trim() === '') {
						throw new Error('S3_ACCESS_KEY_ID is required');
					}
				},
				default: '',
				env: 'S3_ACCESS_KEY_ID'
			},
			secretAccessKey: {
				doc: 'S3 secret access key',
				format: (value: unknown) => {
					if (typeof value !== 'string' || value.trim() === '') {
						throw new Error('S3_SECRET_ACCESS_KEY is required');
					}
				},
				default: '',
				env: 'S3_SECRET_ACCESS_KEY'
			}
		}
	}
});

// Fail fast on misspelled or unsupported environment variables instead of running misconfigured.
config.validate({ allowed: 'strict' });

export default config;
