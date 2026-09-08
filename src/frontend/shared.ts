// Browser logic for a public shared-file page.
import { isSignedIn } from './auth.ts';

// Cache the small set of page elements once; the shared page is rendered only after this script loads.
const fileName = document.querySelector<HTMLElement>('#file-name');
const owner = document.querySelector<HTMLElement>('#file-owner');
const status = document.querySelector<HTMLElement>('#share-status');
const signIn = document.querySelector<HTMLAnchorElement>('#sign-in');
const addButton = document.querySelector<HTMLButtonElement>('#add-to-storage');
const download = document.querySelector<HTMLAnchorElement>('#download-file');

// The final non-empty URL segment is the public token used by every share API request.
const token = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() ?? '');

function showStatus(message: string, isError = false): void {
	// One status element communicates loading, success, and failure without changing page layout.
	if (!status) return;
	status.textContent = message;
	status.classList.toggle('error', isError);
}

async function acceptShare(): Promise<void> {
	// The server creates a reference for the current user; it does not copy the file bytes.
	if (!addButton) return;
	addButton.disabled = true;
	showStatus('Adding file to your storage…');
	try {
		// The token is encoded because it came from a URL path and must remain one path segment.
		const response = await fetch(`/api/shares/${encodeURIComponent(token)}/accept`, {
			method: 'POST'
		});
		if (!response.ok) throw new Error('Unable to add this file to your storage.');
		showStatus('File added. Redirecting to your storage…');
		window.setTimeout(() => window.location.assign('/dashboard'), 500);
	} catch (error) {
		addButton.disabled = false;
		showStatus(error instanceof Error ? error.message : 'Unable to add file.', true);
	}
}

async function loadShare(): Promise<void> {
	// Load public metadata first, then show either the sign-in or accept action. Download remains
	// public, while accepting a share requires an authenticated Clerk session.
	if (!token) {
		showStatus('Invalid share link.', true);
		return;
	}

	try {
		const response = await fetch(`/api/shares/${encodeURIComponent(token)}`);
		if (!response.ok) throw new Error('This share link is no longer available.');
		const share = (await response.json()) as { name: string; ownerUserId: string };
		if (fileName) fileName.textContent = share.name;
		if (owner) owner.textContent = share.ownerUserId;
		if (download) download.href = `/shared/${encodeURIComponent(token)}/download`;

		if (isSignedIn()) {
			if (addButton) addButton.hidden = false;
			if (signIn) signIn.hidden = true;
			showStatus('Add this file to your storage without copying it.');
		} else {
			if (signIn) {
				signIn.hidden = false;
				signIn.href = `/login?redirect_url=${encodeURIComponent(window.location.href)}`;
			}
			showStatus('Sign in to add this file to your storage.');
		}
	} catch (error) {
		showStatus(error instanceof Error ? error.message : 'Unable to load share.', true);
		if (download) download.hidden = true;
	}
}

addButton?.addEventListener('click', () => void acceptShare());
void loadShare();
