import { Clerk } from '@clerk/clerk-js';

declare const CLERK_PUBLISHABLE_KEY: string;

const clerk = new Clerk(CLERK_PUBLISHABLE_KEY);

await clerk.load();

export function signOut(): Promise<void> {
	return clerk.signOut({
		redirectUrl: '/'
	});
}

export function getCurrentUserName(): string {
	const user = clerk.user;
	return (
		user?.fullName ??
		([user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
			user?.username ||
			user?.primaryEmailAddress?.emailAddress ||
			'My account')
	);
}
