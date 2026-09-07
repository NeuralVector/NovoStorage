import { BadRequestException } from '@nestjs/common';

export function validateFilePath(value: string | undefined): string {
	const path = value?.replaceAll('\\', '/');
	if (
		!path ||
		path.startsWith('/') ||
		path.split('/').some((part) => !part || part === '.' || part === '..')
	) {
		throw new BadRequestException('A valid file path is required.');
	}
	return path;
}
