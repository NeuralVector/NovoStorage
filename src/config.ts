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
	}
});

config.validate({ allowed: 'strict' });

export default config;
