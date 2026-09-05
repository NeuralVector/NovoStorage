import { signOut } from './auth.ts';

document.querySelector('#sign-out')?.addEventListener('click', () => {
	signOut();
});

interface StorageItem {
	name: string;
	path: string;
	type: 'file' | 'directory';
}

const status = document.querySelector('#storage-status');
const storageList = document.querySelector('#storage-list');

async function loadStorage(): Promise<void> {
	try {
		const response = await fetch('/api/files');

		if (response.status === 401) {
			window.location.assign('/login');
			return;
		}

		if (!response.ok) {
			throw new Error(`Unable to load files (${response.status})`);
		}

		const items = (await response.json()) as StorageItem[];
		if (status) {
			status.textContent = items.length === 0 ? 'No files yet.' : '';
		}

		if (!storageList) {
			return;
		}

		storageList.replaceChildren();
		for (const item of items) {
			const listItem = document.createElement('li');
			listItem.textContent = `${item.type === 'directory' ? '📁' : '📄'} ${item.name}`;
			listItem.title = item.path;
			storageList.append(listItem);
		}
	} catch (error) {
		if (status) {
			status.textContent =
				error instanceof Error ? error.message : 'Unable to load files.';
		}
	}
}

void loadStorage();
