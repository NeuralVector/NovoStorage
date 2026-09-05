import { signOut } from './auth.ts';

document.querySelector('#sign-out')?.addEventListener('click', () => {
	signOut();
});

const fileInput = document.querySelector('#file-input');
const uploadButton = document.querySelector('#upload-file');

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
			const label = document.createElement('span');
			label.textContent = `${item.type === 'directory' ? '📁' : '📄'} ${item.name}`;
			listItem.append(label);
			listItem.title = item.path;

			if (item.type === 'file') {
				const downloadButton = document.createElement('button');
				downloadButton.type = 'button';
				downloadButton.textContent = 'Download';
				downloadButton.addEventListener('click', () => {
					const query = new URLSearchParams({ path: item.path });
					window.location.assign(`/api/files/download?${query}`);
				});
				listItem.append(' ', downloadButton);
			}

			storageList.append(listItem);
		}
	} catch (error) {
		if (status) {
			status.textContent =
				error instanceof Error ? error.message : 'Unable to load files.';
		}
	}
}

uploadButton?.addEventListener('click', () => {
	(fileInput as HTMLInputElement | null)?.click();
});

fileInput?.addEventListener('change', async () => {
	const input = fileInput as HTMLInputElement;
	const file = input.files?.[0];
	if (!file) {
		return;
	}

	if (status) {
		status.textContent = `Uploading ${file.name}...`;
	}
	if (uploadButton instanceof HTMLButtonElement) {
		uploadButton.disabled = true;
	}

	try {
		const formData = new FormData();
		formData.append('file', file, file.name);
		const response = await fetch('/api/files', {
			method: 'POST',
			body: formData
		});

		if (response.status === 401) {
			window.location.assign('/login');
			return;
		}
		if (!response.ok) {
			throw new Error(`Unable to upload file (${response.status})`);
		}

		input.value = '';
		await loadStorage();
	} catch (error) {
		if (status) {
			status.textContent =
				error instanceof Error ? error.message : 'Unable to upload file.';
		}
	} finally {
		if (uploadButton instanceof HTMLButtonElement) {
			uploadButton.disabled = false;
		}
	}
});

void loadStorage();
