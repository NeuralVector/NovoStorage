// User-provided paths must be validated before becoming S3 object keys.
import { BadRequestException } from '@nestjs/common';

export function validateFilePath(value: string | undefined): string {
	// Normalize Windows separators so paths behave consistently on every OS.
	const path = value?.replaceAll('\\', '/');
	// Reject empty segments as well as dot segments so concatenating this value to a user prefix
	// can never escape the intended virtual directory.
	if (
		!path ||
		path.startsWith('/') ||
		path.split('/').some((part) => !part || part === '.' || part === '..')
	) {
		throw new BadRequestException('A valid file path is required.');
	}
	return path;
}
