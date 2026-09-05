import convict from 'convict';

const config = convict({
	env: {
		doc: 'Application environment',
		format: ['development', 'production', 'test'],
		default: 'development',
		env: 'NODE_ENV'
	},

	server: {
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
		url: {
			doc: 'Public website URL',
			format: String,
			default: 'http://localhost',
			env: 'WEBSITE_URL'
		}
	}
});

config.validate({ allowed: 'strict' });

export default config;
