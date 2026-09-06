import { getCurrentUserName, isSignedIn, signOut } from './auth.ts';

interface StorageItem {
	name: string;
	path: string;
	type: 'file' | 'directory';
	size: number;
}

const fileRows = document.querySelector('#file-rows');
const itemCount = document.querySelector('#item-count');
const breadcrumb = document.querySelector('#breadcrumb');
const filter = document.querySelector<HTMLInputElement>('#file-filter');
const toast = document.querySelector<HTMLElement>('#toast');
const modalBackdrop = document.querySelector<HTMLElement>('#modal-backdrop');
const uploadModal = document.querySelector<HTMLElement>('#upload-modal');
const folderModal = document.querySelector<HTMLElement>('#folder-modal');
const previewModal = document.querySelector<HTMLElement>('#preview-modal');
const previewModalImage = document.querySelector<HTMLImageElement>('#preview-modal-image');
const fileInput = document.querySelector<HTMLInputElement>('#file-input');
const folderName = document.querySelector<HTMLInputElement>('#folder-name');
const pendingFiles = document.querySelector('#pending-files');
const accountName = document.querySelector('#account-name');
const detailsEmpty = document.querySelector<HTMLElement>('#details-empty');
const detailsContent = document.querySelector<HTMLElement>('#details-content');
const detailsPanel = document.querySelector<HTMLElement>('#details-panel');
const appShell = document.querySelector<HTMLElement>('.app-shell');
const preview = document.querySelector<HTMLElement>('#preview');
const previewType = document.querySelector<HTMLElement>('#preview-type');
const previewImage = document.querySelector<HTMLImageElement>('#preview-image');
const detailsResizer = document.createElement('div');
detailsResizer.className = 'details-resizer';
detailsResizer.setAttribute('aria-label', 'Resize details panel');
detailsResizer.setAttribute('role', 'separator');
detailsPanel?.prepend(detailsResizer);
const detailName = document.querySelector('#detail-name');
const detailMeta = document.querySelector('#detail-meta');
const detailLocation = document.querySelector('#detail-location');
const selectedDownload = document.querySelector<HTMLButtonElement>('[data-action="download"]');

let storageItems: StorageItem[] = [];
let selectedItem: StorageItem | null = null;
let currentPath = '';
let previewUrl: string | null = null;
let previewRequest = 0;

function renderBreadcrumb(): void {
	if (!breadcrumb) return;
	breadcrumb.replaceChildren();
	const root = document.createElement('button');
	root.type = 'button';
	root.textContent = 'My storage';
	root.dataset['path'] = '';
	root.addEventListener('click', () => navigateTo(''));
	breadcrumb.append(root);

	const allFilesSeparator = document.createElement('b');
	allFilesSeparator.textContent = '›';
	breadcrumb.append(allFilesSeparator);
	const allFiles = document.createElement('button');
	allFiles.type = 'button';
	allFiles.textContent = 'All files';
	allFiles.dataset['path'] = '';
	allFiles.addEventListener('click', () => navigateTo(''));
	breadcrumb.append(allFiles);

	const parts = currentPath.split('/').filter(Boolean);
	let path = '';
	for (const part of parts) {
		path = path ? `${path}/${part}` : part;
		const separator = document.createElement('b');
		separator.textContent = '›';
		breadcrumb.append(separator);
		const folder = document.createElement('button');
		folder.type = 'button';
		folder.textContent = part;
		const folderPath = path;
		folder.addEventListener('click', () => navigateTo(folderPath));
		breadcrumb.append(folder);
	}
}

function formatFileSize(bytes: number): string {
	if (bytes === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	return `${(bytes / 1024 ** unitIndex).toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function showToast(message: string): void {
	if (!toast) return;
	toast.textContent = message;
	toast.hidden = false;
	window.setTimeout(() => {
		toast.hidden = true;
	}, 3000);
}

function download(item: StorageItem): void {
	const query = new URLSearchParams({ path: item.path });
	window.location.assign(`/api/files/download?${query.toString()}`);
}

function imageMimeType(name: string): string | null {
	const extension = name.split('.').pop()?.toLowerCase();
	const mimeTypes: Record<string, string> = {
		avif: 'image/avif',
		bmp: 'image/bmp',
		gif: 'image/gif',
		jpeg: 'image/jpeg',
		jpg: 'image/jpeg',
		png: 'image/png',
		svg: 'image/svg+xml',
		webp: 'image/webp'
	};
	return extension ? (mimeTypes[extension] ?? null) : null;
}

function resetPreview(): void {
	previewRequest += 1;
	if (previewUrl) URL.revokeObjectURL(previewUrl);
	previewUrl = null;
	if (preview) preview.hidden = true;
	preview?.classList.remove('has-image');
	if (previewType) {
		previewType.hidden = false;
		previewType.textContent = 'FILE';
	}
	if (previewImage) {
		previewImage.hidden = true;
		previewImage.removeAttribute('src');
	}
}

async function loadImagePreview(item: StorageItem): Promise<void> {
	resetPreview();
	const mimeType = imageMimeType(item.name);
	if (item.type !== 'file' || !mimeType || !previewImage) return;

	const request = previewRequest;
	if (preview) preview.hidden = false;
	if (previewType) {
		previewType.hidden = false;
		previewType.textContent = 'Loading preview…';
	}

	try {
		const query = new URLSearchParams({ path: item.path });
		const response = await fetch(`/api/files/download?${query.toString()}`);
		if (request !== previewRequest) return;
		if (!response.ok) {
			if (previewType) previewType.textContent = 'Preview unavailable';
			return;
		}

		const file = await response.blob();
		if (request !== previewRequest) return;

		previewUrl = URL.createObjectURL(new Blob([file], { type: mimeType }));
		previewImage.src = previewUrl;
		previewImage.alt = item.name;
		previewImage.hidden = false;
		preview?.classList.add('has-image');
		if (previewType) previewType.hidden = true;
	} catch {
		if (request === previewRequest && previewType) {
			previewType.textContent = 'Preview unavailable';
		}
	}
}

function selectItem(item: StorageItem): void {
	selectedItem = item;
	if (detailsPanel) detailsPanel.hidden = false;
	appShell?.classList.add('has-details');
	if (detailsEmpty) detailsEmpty.hidden = true;
	if (detailsContent) detailsContent.hidden = false;
	if (detailName) detailName.textContent = item.name;
	if (detailMeta) {
		detailMeta.textContent = `${item.type.toUpperCase()} · ${formatFileSize(item.size)}`;
	}
	if (detailLocation) detailLocation.textContent = item.path;
	if (selectedDownload) selectedDownload.hidden = item.type !== 'file';
	void loadImagePreview(item);
	for (const row of document.querySelectorAll<HTMLElement>('.file-row')) {
		row.classList.toggle('selected', row.dataset['path'] === item.path);
	}
}

function navigateTo(path: string): void {
	currentPath = path;
	selectedItem = null;
	resetPreview();
	if (detailsPanel) detailsPanel.hidden = true;
	appShell?.classList.remove('has-details');
	renderBreadcrumb();
	renderItems();
}

function emptyState(): HTMLElement {
	const empty = document.createElement('div');
	empty.className = 'empty-state';
	empty.innerHTML =
		'<div class="empty-icon">▰</div><h2>Your storage is empty</h2><p>Upload a file to get started.</p>';
	const actions = document.createElement('div');
	const upload = document.createElement('button');
	upload.className = 'primary';
	upload.type = 'button';
	upload.textContent = 'Upload files';
	upload.dataset['action'] = 'open-upload';
	actions.append(upload);
	empty.append(actions);
	return empty;
}

function loadingState(): HTMLElement {
	const loading = document.createElement('div');
	loading.className = 'loading-state';
	loading.innerHTML =
		'<span class="loading-spinner" aria-hidden="true"></span><p>Loading your files...</p>';
	return loading;
}

function setLoading(): void {
	if (fileRows) fileRows.replaceChildren(loadingState());
	if (itemCount) itemCount.textContent = 'Loading...';
}

function setLoadError(): void {
	if (!fileRows) return;
	const error = document.createElement('div');
	error.className = 'empty-state';
	error.innerHTML =
		'<div class="empty-icon">!</div><h2>Unable to load files</h2><p>Try refreshing the page.</p>';
	fileRows.replaceChildren(error);
}

function renderItems(): void {
	if (!fileRows) return;
	const search = filter?.value.trim().toLowerCase() ?? '';
	const prefix = currentPath ? `${currentPath}/` : '';
	const visibleItems = storageItems.filter((item) => {
		if (!item.path.startsWith(prefix) || item.path === currentPath) return false;
		const relativePath = item.path.slice(prefix.length);
		return (
			relativePath.split('/').filter(Boolean).length === 1 &&
			item.name.toLowerCase().includes(search)
		);
	});
	if (itemCount) itemCount.textContent = `${visibleItems.length} items`;
	fileRows.replaceChildren();
	if (visibleItems.length === 0) {
		fileRows.append(emptyState());
		return;
	}

	for (const item of visibleItems) {
		const row = document.createElement('div');
		row.className = 'file-row';
		row.dataset['path'] = item.path;
		row.setAttribute('role', 'row');

		const name = document.createElement('button');
		name.className = 'file-name';
		name.type = 'button';
		name.textContent = `${item.type === 'directory' ? '📁' : '📄'} ${item.name}`;
		name.addEventListener('click', () => {
			if (item.type === 'directory') navigateTo(item.path);
			else selectItem(item);
		});
		row.append(name);

		for (const value of [
			item.type === 'directory' ? '—' : 'You',
			'—',
			item.type === 'directory' ? '—' : formatFileSize(item.size)
		]) {
			const cell = document.createElement('span');
			cell.textContent = value;
			row.append(cell);
		}

		const action = document.createElement('button');
		action.className = 'download';
		action.type = 'button';
		action.textContent = item.type === 'file' ? 'Download' : '';
		action.hidden = item.type !== 'file';
		action.addEventListener('click', () => download(item));
		row.append(action);
		fileRows.append(row);
	}
}

async function loadStorage(): Promise<void> {
	setLoading();
	try {
		const response = await fetch('/api/files');
		if (response.status === 401) {
			window.location.assign('/login');
			return;
		}
		if (!response.ok) throw new Error(`Unable to load files (${response.status})`);
		storageItems = (await response.json()) as StorageItem[];
		renderItems();
	} catch (error) {
		setLoadError();
		showToast(error instanceof Error ? error.message : 'Unable to load files.');
	}
}

function openModal(modal: HTMLElement | null): void {
	if (!modalBackdrop || !modal) return;
	modalBackdrop.hidden = false;
	modal.hidden = false;
}

function closeModal(): void {
	if (!modalBackdrop) return;
	modalBackdrop.hidden = true;
	if (uploadModal) uploadModal.hidden = true;
	if (folderModal) folderModal.hidden = true;
	if (previewModal) previewModal.hidden = true;
	if (previewModalImage) previewModalImage.removeAttribute('src');
}

function openImagePreview(): void {
	if (!previewImage?.src || !previewModal || !previewModalImage || !modalBackdrop) return;
	previewModalImage.src = previewImage.src;
	previewModalImage.alt = previewImage.alt;
	modalBackdrop.hidden = false;
	previewModal.hidden = false;
}

async function uploadFiles(): Promise<void> {
	const files = fileInput?.files;
	if (!files || files.length === 0) {
		showToast('Choose at least one file.');
		return;
	}

	for (const file of files) {
		const formData = new FormData();
		formData.append('file', file, file.name);
		const query = currentPath ? `?path=${encodeURIComponent(currentPath)}` : '';
		const response = await fetch(`/api/files${query}`, {
			method: 'POST',
			body: formData
		});
		if (response.status === 401) {
			window.location.assign('/login');
			return;
		}
		if (!response.ok) throw new Error(`Unable to upload ${file.name}`);
	}

	fileInput.value = '';
	if (pendingFiles) pendingFiles.textContent = 'No files selected';
	closeModal();
	showToast('Upload complete.');
	await loadStorage();
}

async function createDirectory(): Promise<void> {
	const name = folderName?.value.trim();
	if (!name) {
		showToast('Enter a folder name.');
		return;
	}

	const response = await fetch('/api/directories', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ name, parent: currentPath })
	});
	if (response.status === 401) {
		window.location.assign('/login');
		return;
	}
	if (!response.ok) throw new Error('Unable to create folder.');

	if (folderName) folderName.value = '';
	closeModal();
	showToast('Folder created.');
	await loadStorage();
}

document.addEventListener('click', (event) => {
	const target = event.target as HTMLElement;
	const action = target.closest<HTMLElement>('[data-action]')?.dataset['action'];
	if (!action) return;

	switch (action) {
		case 'sign-out':
			void signOut();
			break;
		case 'create-menu': {
			const menu = document.querySelector<HTMLElement>('.create-menu');
			if (menu) menu.hidden = !menu.hidden;
			break;
		}
		case 'open-upload':
			openModal(uploadModal);
			break;
		case 'open-folder':
			openModal(folderModal);
			break;
		case 'close-modal':
			closeModal();
			break;
		case 'queue-upload':
			void uploadFiles().catch((error: unknown) =>
				showToast(error instanceof Error ? error.message : 'Upload failed.')
			);
			break;
		case 'create-folder':
			void createDirectory().catch((error: unknown) =>
				showToast(
					error instanceof Error
						? error.message
						: 'Unable to create folder.'
				)
			);
			break;
		case 'download':
			if (selectedItem?.type === 'file') download(selectedItem);
			break;
		case 'refresh':
			void loadStorage();
			break;
		case 'close-details':
			resetPreview();
			if (detailsPanel) detailsPanel.hidden = true;
			appShell?.classList.remove('has-details');
			if (detailsEmpty) detailsEmpty.hidden = false;
			if (detailsContent) detailsContent.hidden = true;
			selectedItem = null;
			break;
	}
});

document;
detailsResizer?.addEventListener('pointerdown', (event) => {
	event.preventDefault();
	const resize = (moveEvent: PointerEvent): void => {
		const width = Math.min(520, Math.max(240, window.innerWidth - moveEvent.clientX));
		appShell?.style.setProperty('--details-width', `${width}px`);
	};
	const stopResize = (): void => {
		document.removeEventListener('pointermove', resize);
		document.removeEventListener('pointerup', stopResize);
	};
	document.addEventListener('pointermove', resize);
	document.addEventListener('pointerup', stopResize, { once: true });
});

filter?.addEventListener('input', renderItems);
fileInput?.addEventListener('change', () => {
	if (pendingFiles) {
		pendingFiles.textContent = fileInput.files?.length
			? `${fileInput.files.length} file(s) selected`
			: 'No files selected';
	}
});

previewImage?.addEventListener('click', openImagePreview);

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
	button.addEventListener('click', () => {
		for (const item of document.querySelectorAll('[data-view]'))
			item.classList.remove('active');
		button.classList.add('active');
		if (button.dataset['view'] !== 'storage')
			showToast('This view is not available yet.');
	});
}

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view-mode]')) {
	button.addEventListener('click', () => {
		for (const item of document.querySelectorAll('[data-view-mode]'))
			item.classList.remove('selected');
		button.classList.add('selected');
		fileRows?.parentElement?.classList.toggle(
			'grid',
			button.dataset['viewMode'] === 'grid'
		);
	});
}

if (accountName) accountName.textContent = getCurrentUserName();
renderBreadcrumb();
if (isSignedIn()) {
	void loadStorage();
} else {
	window.location.replace('/login');
}
