// Browser-side Clerk setup. This module is shared by the dashboard and share page.
import { Clerk } from '@clerk/clerk-js';

declare const CLERK_PUBLISHABLE_KEY: string;

// The publishable key is safe to expose in browser code; secret operations stay server-side.
const clerk = new Clerk(CLERK_PUBLISHABLE_KEY);

// Wait until Clerk has restored or established the browser session.
await clerk.load();

export function isSignedIn(): boolean {
	// Keep callers independent from Clerk's object model by exposing the simple boolean they need.
	return clerk.isSignedIn;
}

export function signOut(): Promise<void> {
	// Clerk clears the browser session and returns the user to the public landing page.
	return clerk.signOut({
		redirectUrl: '/'
	});
}

export function getCurrentUserName(): string {
	// Prefer a human-readable name, then fall back through Clerk's other available identifiers.
	const user = clerk.user;
	return (
		user?.fullName ??
		([user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
			user?.username ||
			user?.primaryEmailAddress?.emailAddress ||
			'My account')
	);
}
