import { getCurrentUserName, isSignedIn, signOut } from './auth.ts';

interface StorageItem {
	name: string;
	path: string;
	type: 'file' | 'directory';
	size: number;
	lastModified: string | null;
	owner: string;
	referenceId?: string;
	virtual?: boolean;
}

interface StorageUsage {
	usedBytes: number;
	quotaBytes: number;
	remainingBytes: number;
}

interface SelectedUpload {
	file: File;
	relativePath: string;
}

interface DroppedEntry {
	isFile: boolean;
	isDirectory: boolean;
	name: string;
	file?: (onFile: (file: File) => void, onError?: (error: unknown) => void) => void;
	createReader?: () => DroppedDirectoryReader;
}

interface DroppedDirectoryReader {
	readEntries: (
		onEntries: (entries: DroppedEntry[]) => void,
		onError?: (error: unknown) => void
	) => void;
}

const fileRows = document.querySelector('#file-rows');
const itemCount = document.querySelector('#item-count');
const storageUsageText = document.querySelector<HTMLElement>('#storage-usage');
const storageRemainingText = document.querySelector<HTMLElement>('#storage-remaining');
const storageUsageBar = document.querySelector<HTMLElement>('#storage-usage-bar');
const selectAll = document.querySelector<HTMLInputElement>('#select-all');
const selectionActions = document.querySelector<HTMLElement>('#selection-actions');
const selectionCount = document.querySelector<HTMLElement>('#selection-count');
const breadcrumb = document.querySelector('#breadcrumb');
const filter = document.querySelector<HTMLInputElement>('#file-filter');
const toast = document.querySelector<HTMLElement>('#toast');
const modalBackdrop = document.querySelector<HTMLElement>('#modal-backdrop');
const uploadModal = document.querySelector<HTMLElement>('#upload-modal');
const folderModal = document.querySelector<HTMLElement>('#folder-modal');
const previewModal = document.querySelector<HTMLElement>('#preview-modal');
const previewModalImage = document.querySelector<HTMLImageElement>('#preview-modal-image');
const previewModalVideo = document.querySelector<HTMLVideoElement>('#preview-modal-video');
const contentsModal = document.querySelector<HTMLElement>('#contents-modal');
const contentsTitle = document.querySelector<HTMLElement>('#contents-title');
const contentsStatus = document.querySelector<HTMLElement>('#contents-status');
const contentsText = document.querySelector<HTMLElement>('#contents-text');
const fileInput = document.querySelector<HTMLInputElement>('#file-input');
const folderInput = document.querySelector<HTMLInputElement>('#folder-input');
const dropZone = document.querySelector<HTMLElement>('.drop-zone');
const uploadButton = document.querySelector<HTMLButtonElement>('[data-action="queue-upload"]');
const uploadStatus = document.querySelector<HTMLElement>('#upload-status');
const uploadStatusText = document.querySelector<HTMLElement>('#upload-status-text');
const uploadCloseButtons = uploadModal?.querySelectorAll<HTMLButtonElement>(
	'[data-action="close-modal"]'
);
const folderName = document.querySelector<HTMLInputElement>('#folder-name');
const pendingFiles = document.querySelector('#pending-files');
const accountName = document.querySelector('#account-name');
const themeToggle = document.querySelector<HTMLButtonElement>('[data-action="toggle-theme"]');
const moonIcon = themeToggle?.querySelector<SVGElement>('[data-theme-icon="moon"]');
const sunIcon = themeToggle?.querySelector<SVGElement>('[data-theme-icon="sun"]');
const detailsEmpty = document.querySelector<HTMLElement>('#details-empty');
const detailsContent = document.querySelector<HTMLElement>('#details-content');
const detailsPanel = document.querySelector<HTMLElement>('#details-panel');
const appShell = document.querySelector<HTMLElement>('.app-shell');
const preview = document.querySelector<HTMLElement>('#preview');
const previewType = document.querySelector<HTMLElement>('#preview-type');
const previewImage = document.querySelector<HTMLImageElement>('#preview-image');
const previewVideo = document.querySelector<HTMLVideoElement>('#preview-video');
const previewPlay = document.querySelector<HTMLButtonElement>('#preview-play');
const detailsResizer = document.createElement('div');
detailsResizer.className = 'details-resizer';
detailsResizer.setAttribute('aria-label', 'Resize details panel');
detailsResizer.setAttribute('role', 'separator');
detailsPanel?.prepend(detailsResizer);
const detailName = document.querySelector('#detail-name');
const detailMeta = document.querySelector('#detail-meta');
const detailLocation = document.querySelector('#detail-location');
const detailModified = document.querySelector('#detail-modified');
const selectedDownload = document.querySelector<HTMLButtonElement>('[data-action="download"]');
const selectedContents = document.querySelector<HTMLButtonElement>('[data-action="view-contents"]');
const selectedShare = document.querySelector<HTMLButtonElement>('[data-action="share"]');
const selectedDelete = document.querySelector<HTMLButtonElement>('[data-action="delete"]');

let storageItems: StorageItem[] = [];
let selectedItem: StorageItem | null = null;
let selectedPaths = new Set<string>();
let currentPath = '';
let previewUrl: string | null = null;
let previewRequest = 0;
let contentsRequest = 0;
let selectedUploads: SelectedUpload[] = [];
let isUploading = false;

function applyTheme(theme: 'light' | 'dark'): void {
	document.documentElement.dataset['theme'] = theme;
	localStorage.setItem('novostorage-theme', theme);
	if (themeToggle) {
		const nextTheme = theme === 'dark' ? 'light' : 'dark';
		moonIcon?.toggleAttribute('hidden', theme === 'dark');
		sunIcon?.toggleAttribute('hidden', theme !== 'dark');
		themeToggle.setAttribute('aria-pressed', String(theme === 'dark'));
		themeToggle.setAttribute('aria-label', `Enable ${nextTheme} mode`);
		themeToggle.title = `Enable ${nextTheme} mode`;
	}
}

const savedTheme = localStorage.getItem('novostorage-theme');
applyTheme(savedTheme === 'dark' ? 'dark' : 'light');

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

function formatLastModified(value: string | null): string {
	if (!value) return '—';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '—';
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short'
	}).format(date);
}

function showToast(message: string): void {
	if (!toast) return;
	toast.textContent = message;
	toast.hidden = false;
	window.setTimeout(() => {
		toast.hidden = true;
	}, 3000);
}

function renderStorageUsage(usage: StorageUsage): void {
	const percentage = usage.quotaBytes
		? Math.min(100, (usage.usedBytes / usage.quotaBytes) * 100)
		: 100;
	if (storageUsageText) {
		storageUsageText.textContent = `${formatFileSize(usage.usedBytes)} of ${formatFileSize(usage.quotaBytes)} used`;
	}
	if (storageRemainingText) {
		storageRemainingText.textContent = `${formatFileSize(usage.remainingBytes)} left`;
	}
	if (storageUsageBar) storageUsageBar.style.width = `${percentage}%`;
}

async function loadStorageUsage(): Promise<StorageUsage | null> {
	const response = await fetch('/api/storage/usage');
	if (response.status === 401) {
		window.location.assign('/login');
		return null;
	}
	if (!response.ok) throw new Error(`Unable to load storage usage (${response.status})`);
	const usage = (await response.json()) as StorageUsage;
	renderStorageUsage(usage);
	return usage;
}

function download(item: StorageItem): void {
	const query = new URLSearchParams({ path: item.path });
	if (item.referenceId) query.set('referenceId', item.referenceId);
	const link = document.createElement('a');
	link.href = `/api/files/download?${query.toString()}`;
	link.download = item.name;
	link.rel = 'noopener';
	document.body.append(link);
	link.click();
	link.remove();
}

async function viewContents(item: StorageItem): Promise<void> {
	if (!contentsModal || !contentsTitle || !contentsStatus || !contentsText || !modalBackdrop)
		return;
	const request = ++contentsRequest;
	contentsTitle.textContent = item.name;
	contentsStatus.textContent = 'Loading…';
	contentsText.replaceChildren();
	modalBackdrop.hidden = false;
	contentsModal.hidden = false;

	try {
		const query = new URLSearchParams({ path: item.path });
		if (item.referenceId) query.set('referenceId', item.referenceId);
		const response = await fetch(`/api/files/download?${query.toString()}`);
		if (response.status === 401) {
			window.location.assign('/login');
			return;
		}
		if (!response.ok) throw new Error('Unable to read file contents.');

		const contentType = response.headers.get('content-type');
		const charset = contentType?.match(/charset=([^;]+)/i)?.[1]?.trim();
		let decoder: TextDecoder;
		try {
			decoder = new TextDecoder(charset ?? 'utf-8');
		} catch {
			decoder = new TextDecoder('utf-8');
		}
		const reader = response.body?.getReader();
		if (!reader) {
			contentsText.textContent = await response.text();
		} else {
			while (true) {
				const result = await reader.read();
				if (request !== contentsRequest) {
					await reader.cancel();
					return;
				}
				if (result.value) {
					contentsText.append(
						document.createTextNode(
							decoder.decode(result.value, {
								stream: !result.done
							})
						)
					);
				}
				if (result.done) break;
			}
			contentsText.append(document.createTextNode(decoder.decode()));
		}
		if (request === contentsRequest) {
			contentsStatus.textContent = '';
		}
	} catch (error) {
		if (request !== contentsRequest) return;
		contentsStatus.textContent =
			error instanceof Error ? error.message : 'Unable to read file contents.';
	}
}

async function share(item: StorageItem): Promise<void> {
	const response = await fetch('/api/shares', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ path: item.path })
	});
	if (response.status === 401) {
		window.location.assign('/login');
		return;
	}
	if (!response.ok) throw new Error('Unable to create share link.');

	const body = (await response.json()) as { url?: string };
	if (!body.url) throw new Error('The share link was not returned.');
	try {
		await navigator.clipboard.writeText(body.url);
		showToast('Share link copied.');
	} catch {
		window.prompt('Copy this share link:', body.url);
	}
}

function visibleItems(): StorageItem[] {
	const search = filter?.value.trim().toLowerCase() ?? '';
	const prefix = currentPath ? `${currentPath}/` : '';
	return storageItems.filter((item) => {
		if (!item.path.startsWith(prefix) || item.path === currentPath) return false;
		const relativePath = item.path.slice(prefix.length);
		return (
			relativePath.split('/').filter(Boolean).length === 1 &&
			item.name.toLowerCase().includes(search)
		);
	});
}

function selectedStorageItems(): StorageItem[] {
	return storageItems.filter((item) => selectedPaths.has(item.path) && !item.virtual);
}

function updateSelectionUi(items = visibleItems()): void {
	const selectedCount = selectedStorageItems().length;
	if (selectionActions) selectionActions.hidden = selectedCount === 0;
	if (selectionCount) {
		selectionCount.textContent = `${selectedCount} selected`;
	}
	if (selectAll) {
		const selectableItems = items.filter((item) => !item.virtual);
		const selectedVisibleCount = selectableItems.filter((item) =>
			selectedPaths.has(item.path)
		).length;
		selectAll.checked =
			selectableItems.length > 0 &&
			selectedVisibleCount === selectableItems.length;
		selectAll.indeterminate =
			selectedVisibleCount > 0 && selectedVisibleCount < selectableItems.length;
	}
}

function clearSelection(): void {
	selectedPaths.clear();
	updateSelectionUi();
}

function downloadSelected(): void {
	const files = new Map<string, StorageItem>();
	for (const item of selectedStorageItems()) {
		if (item.type === 'file') files.set(item.path, item);
		else {
			for (const child of storageItems) {
				if (
					child.type === 'file' &&
					child.path.startsWith(`${item.path}/`)
				) {
					files.set(child.path, child);
				}
			}
		}
	}

	if (files.size === 0) {
		showToast('The selected folders contain no files.');
		return;
	}

	[...files.values()].forEach((item, index) => {
		window.setTimeout(() => download(item), index * 150);
	});
	showToast(`Starting ${files.size} download${files.size === 1 ? '' : 's'}.`);
}

async function deleteItem(item: StorageItem): Promise<void> {
	const query = new URLSearchParams({ path: item.path });
	if (item.referenceId) query.set('referenceId', item.referenceId);
	const response = await fetch(`/api/files?${query.toString()}`, {
		method: 'DELETE'
	});
	if (response.status === 401) {
		window.location.assign('/login');
		return;
	}
	if (!response.ok) {
		let message = 'Unable to delete item.';
		try {
			const body = (await response.json()) as { message?: string };
			if (body.message) message = body.message;
		} catch {
			// Keep the generic message when the response is not JSON.
		}
		throw new Error(message);
	}

	selectedItem = null;
	resetPreview();
	if (detailsPanel) detailsPanel.hidden = true;
	appShell?.classList.remove('has-details');
	if (detailsEmpty) detailsEmpty.hidden = false;
	if (detailsContent) detailsContent.hidden = true;
	showToast(`${item.type === 'directory' ? 'Folder' : 'File'} deleted.`);
	await Promise.all([loadStorage(), loadStorageUsage()]);
}

async function deleteSelected(): Promise<void> {
	const items = selectedStorageItems();
	if (items.length === 0) return;
	const label = items.length === 1 ? 'this item' : `these ${items.length} items`;
	if (!window.confirm(`Delete ${label}? Folders and their files will be deleted.`)) return;

	await Promise.all(
		items.map(async (item) => {
			const query = new URLSearchParams({ path: item.path });
			if (item.referenceId) query.set('referenceId', item.referenceId);
			const response = await fetch(`/api/files?${query.toString()}`, {
				method: 'DELETE'
			});
			if (response.status === 401) {
				window.location.assign('/login');
				throw new Error('Authentication required.');
			}
			if (!response.ok) throw new Error(`Unable to delete ${item.name}.`);
		})
	);

	selectedPaths.clear();
	selectedItem = null;
	resetPreview();
	if (detailsPanel) detailsPanel.hidden = true;
	appShell?.classList.remove('has-details');
	if (detailsEmpty) detailsEmpty.hidden = false;
	if (detailsContent) detailsContent.hidden = true;
	showToast(`${items.length} item${items.length === 1 ? '' : 's'} deleted.`);
	await Promise.all([loadStorage(), loadStorageUsage()]);
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

function videoMimeType(name: string): string | null {
	const extension = name.split('.').pop()?.toLowerCase();
	const mimeTypes: Record<string, string> = {
		m4v: 'video/mp4',
		mov: 'video/quicktime',
		mp4: 'video/mp4',
		ogv: 'video/ogg',
		webm: 'video/webm'
	};
	return extension ? (mimeTypes[extension] ?? null) : null;
}

function videoStreamUrl(item: StorageItem): string {
	const query = new URLSearchParams({ path: item.path });
	if (item.referenceId) query.set('referenceId', item.referenceId);
	return `/api/files/stream?${query.toString()}`;
}

function resetPreview(): void {
	previewRequest += 1;
	if (previewUrl) URL.revokeObjectURL(previewUrl);
	previewUrl = null;
	if (preview) preview.hidden = true;
	preview?.classList.remove('has-image', 'has-video');
	if (previewType) {
		previewType.hidden = false;
		previewType.textContent = 'FILE';
	}
	if (previewImage) {
		previewImage.hidden = true;
		previewImage.removeAttribute('src');
	}
	if (previewVideo) {
		previewVideo.pause();
		previewVideo.removeAttribute('src');
		previewVideo.load();
		previewVideo.hidden = true;
	}
	if (previewPlay) previewPlay.hidden = true;
}

async function loadImagePreview(item: StorageItem): Promise<void> {
	resetPreview();
	const mimeType = imageMimeType(item.name);
	const videoType = videoMimeType(item.name);
	if (item.type !== 'file' || (!mimeType && !videoType)) return;

	const request = previewRequest;
	if (preview) preview.hidden = false;
	if (previewType) {
		previewType.hidden = false;
		previewType.textContent = 'Loading preview…';
	}

	if (videoType && previewVideo) {
		previewVideo.src = videoStreamUrl(item);
		previewVideo.hidden = false;
		previewVideo.onloadeddata = () => {
			if (request !== previewRequest) return;
			preview?.classList.add('has-video');
			if (previewType) previewType.hidden = true;
			if (previewPlay) previewPlay.hidden = false;
		};
		previewVideo.onerror = () => {
			if (request === previewRequest && previewType) {
				previewType.textContent = 'Preview unavailable';
			}
		};
		previewVideo.load();
		return;
	}

	if (!mimeType || !previewImage) return;

	try {
		const query = new URLSearchParams({ path: item.path });
		if (item.referenceId) query.set('referenceId', item.referenceId);
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
	if (detailModified) detailModified.textContent = formatLastModified(item.lastModified);
	if (selectedDownload) selectedDownload.hidden = item.type !== 'file';
	if (selectedContents) selectedContents.hidden = item.type !== 'file';
	if (selectedShare) selectedShare.hidden = item.type !== 'file' || Boolean(item.referenceId);
	if (selectedDelete) selectedDelete.hidden = false;
	void loadImagePreview(item);
	for (const row of document.querySelectorAll<HTMLElement>('.file-row')) {
		row.classList.toggle('selected', row.dataset['path'] === item.path);
	}
}

function navigateTo(path: string): void {
	currentPath = path;
	selectedItem = null;
	clearSelection();
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
	const items = visibleItems();
	if (itemCount) itemCount.textContent = `${items.length} items`;
	fileRows.replaceChildren();
	if (items.length === 0) {
		fileRows.append(emptyState());
		updateSelectionUi(items);
		return;
	}

	for (const item of items) {
		const row = document.createElement('div');
		row.className = 'file-row';
		row.dataset['path'] = item.path;
		row.setAttribute('role', 'row');
		const checkbox = document.createElement('input');
		checkbox.className = 'select-item';
		checkbox.type = 'checkbox';
		checkbox.disabled = Boolean(item.virtual);
		checkbox.checked = selectedPaths.has(item.path);
		checkbox.setAttribute('aria-label', `Select ${item.name}`);
		checkbox.addEventListener('change', () => {
			if (checkbox.checked) selectedPaths.add(item.path);
			else selectedPaths.delete(item.path);
			renderItems();
		});
		row.append(checkbox);

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
			item.type === 'directory' ? '—' : item.owner,
			formatLastModified(item.lastModified),
			item.type === 'directory' ? '—' : formatFileSize(item.size)
		]) {
			const cell = document.createElement('span');
			cell.textContent = value;
			row.append(cell);
		}

		const action = document.createElement('button');
		action.className = item.type === 'file' ? 'download' : 'delete';
		action.type = 'button';
		const actionName = item.type === 'file' ? 'Download' : 'Delete';
		if (item.virtual) {
			action.hidden = true;
		}
		action.setAttribute('aria-label', actionName);
		action.title = actionName;
		action.innerHTML =
			item.type === 'file'
				? '<svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 21h14" /></svg>'
				: '<svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16m-11 0V4h6v3m-9 0 1 14h10l1-14m-7 4v6m4-6v6" /></svg>';
		action.addEventListener('click', () => {
			if (item.type === 'file') {
				download(item);
				return;
			}

			if (window.confirm('Delete this folder and all its files?')) {
				void deleteItem(item).catch((error: unknown) =>
					showToast(
						error instanceof Error
							? error.message
							: 'Unable to delete folder.'
					)
				);
			}
		});
		row.append(action);
		fileRows.append(row);
	}
	updateSelectionUi(items);
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
		selectedPaths = new Set(
			[...selectedPaths].filter((path) =>
				storageItems.some((item) => item.path === path)
			)
		);
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

function renderSelectedFiles(files: SelectedUpload[]): void {
	if (!pendingFiles) return;
	pendingFiles.replaceChildren();

	if (files.length === 0) {
		const empty = document.createElement('p');
		empty.className = 'pending-files-empty';
		empty.textContent = 'No files selected';
		pendingFiles.append(empty);
		return;
	}

	const list = document.createElement('ul');
	list.className = 'pending-file-list';
	for (const selected of files) {
		const file = selected.file;
		const item = document.createElement('li');
		item.className = 'pending-file';

		const name = document.createElement('span');
		name.className = 'pending-file-name';
		name.textContent = selected.relativePath || file.name;
		name.title = name.textContent;

		const size = document.createElement('span');
		size.className = 'pending-file-size';
		size.textContent = formatFileSize(file.size);

		item.append(name, size);
		list.append(item);
	}
	pendingFiles.append(list);
}

function filesToUploads(files: FileList | null): SelectedUpload[] {
	return [...(files ?? [])].map((file) => ({
		file,
		relativePath:
			(file as File & { webkitRelativePath?: string }).webkitRelativePath ?? ''
	}));
}

function updateSelectedFiles(files: SelectedUpload[], append = false): void {
	selectedUploads = append ? [...selectedUploads, ...files] : files;
	renderSelectedFiles(selectedUploads);
}

function readDroppedFile(entry: DroppedEntry, directoryPath: string): Promise<SelectedUpload> {
	return new Promise((resolve, reject) => {
		if (!entry.file) {
			reject(new Error(`Unable to read ${entry.name}.`));
			return;
		}

		entry.file(
			(file) =>
				resolve({
					file,
					relativePath: directoryPath
						? `${directoryPath}/${file.name}`
						: ''
				}),
			reject
		);
	});
}

async function readDroppedDirectory(
	entry: DroppedEntry,
	directoryPath: string
): Promise<SelectedUpload[]> {
	const reader = entry.createReader?.();
	if (!reader) return [];

	const files: SelectedUpload[] = [];
	while (true) {
		const entries = await new Promise<DroppedEntry[]>((resolve, reject) => {
			reader.readEntries(resolve, reject);
		});
		if (entries.length === 0) break;

		for (const child of entries) {
			if (child.isDirectory) {
				files.push(
					...(await readDroppedDirectory(
						child,
						directoryPath
							? `${directoryPath}/${child.name}`
							: child.name
					))
				);
			} else if (child.isFile) {
				files.push(await readDroppedFile(child, directoryPath));
			}
		}
	}

	return files;
}

async function readDroppedItems(dataTransfer: DataTransfer): Promise<SelectedUpload[]> {
	const items = [...dataTransfer.items] as unknown as Array<{
		webkitGetAsEntry?: () => DroppedEntry | null;
	}>;
	const entries = items
		.map((item) => item.webkitGetAsEntry?.() ?? null)
		.filter((entry): entry is DroppedEntry => entry !== null);

	if (entries.length === 0) {
		return [...dataTransfer.files].map((file) => ({ file, relativePath: '' }));
	}

	const files: SelectedUpload[] = [];
	for (const entry of entries) {
		if (entry.isDirectory) {
			files.push(...(await readDroppedDirectory(entry, entry.name)));
		} else if (entry.isFile) {
			files.push(await readDroppedFile(entry, ''));
		}
	}
	return files;
}

function clearSelectedFiles(): void {
	if (fileInput) fileInput.value = '';
	if (folderInput) folderInput.value = '';
	selectedUploads = [];
	renderSelectedFiles(selectedUploads);
}

function setUploading(uploading: boolean): void {
	isUploading = uploading;
	if (uploadStatus) uploadStatus.hidden = !uploading;
	if (uploadButton) {
		uploadButton.disabled = uploading;
		uploadButton.textContent = uploading ? 'Uploading…' : 'Upload';
	}
	for (const button of uploadCloseButtons ?? []) button.disabled = uploading;
	if (fileInput) fileInput.disabled = uploading;
	if (folderInput) folderInput.disabled = uploading;
	if (dropZone) {
		dropZone.setAttribute('aria-busy', String(uploading));
		if (uploading) dropZone.classList.remove('drag-over');
	}
}

renderSelectedFiles(selectedUploads);

function closeModal(): void {
	if (!modalBackdrop) return;
	const uploadWasOpen = Boolean(uploadModal && !uploadModal.hidden);
	if (uploadWasOpen && isUploading) return;
	modalBackdrop.hidden = true;
	if (uploadModal) uploadModal.hidden = true;
	if (folderModal) folderModal.hidden = true;
	if (previewModal) previewModal.hidden = true;
	contentsRequest += 1;
	if (contentsModal) contentsModal.hidden = true;
	if (contentsText) contentsText.replaceChildren();
	if (previewModalImage) {
		previewModalImage.hidden = true;
		previewModalImage.removeAttribute('src');
	}
	if (previewModalVideo) {
		previewModalVideo.pause();
		previewModalVideo.removeAttribute('src');
		previewModalVideo.load();
		previewModalVideo.hidden = true;
	}
	if (uploadWasOpen) clearSelectedFiles();
}

function openImagePreview(): void {
	if (!previewImage?.src || !previewModal || !previewModalImage || !modalBackdrop) return;
	previewModalImage.src = previewImage.src;
	previewModalImage.alt = previewImage.alt;
	previewModalImage.hidden = false;
	if (previewModalVideo) {
		previewModalVideo.pause();
		previewModalVideo.hidden = true;
	}
	modalBackdrop.hidden = false;
	previewModal.hidden = false;
}

function openVideoPreview(): void {
	if (!previewVideo?.src || !previewModal || !previewModalVideo || !modalBackdrop) return;
	if (previewModalImage) {
		previewModalImage.hidden = true;
		previewModalImage.removeAttribute('src');
	}
	previewModalVideo.src = previewVideo.src;
	previewModalVideo.hidden = false;
	modalBackdrop.hidden = false;
	previewModal.hidden = false;
	previewModalVideo.load();
	void previewModalVideo.play().catch(() => undefined);
}

async function uploadFiles(): Promise<void> {
	if (isUploading) return;
	if (selectedUploads.length === 0) {
		showToast('Choose at least one file.');
		return;
	}

	setUploading(true);
	try {
		if (uploadStatusText) uploadStatusText.textContent = 'Checking available storage…';
		const totalSize = selectedUploads.reduce(
			(total, selected) => total + selected.file.size,
			0
		);
		const usage = await loadStorageUsage();
		if (!usage) return;
		if (totalSize > usage.remainingBytes) {
			throw new Error(
				`Not enough storage space. ${formatFileSize(totalSize)} required, ${formatFileSize(usage.remainingBytes)} available.`
			);
		}

		for (const [index, selected] of selectedUploads.entries()) {
			const file = selected.file;
			const relativeParts = selected.relativePath
				.replaceAll('\\', '/')
				.split('/')
				.filter(Boolean);
			relativeParts.pop();
			const directoryPath = [currentPath, ...relativeParts]
				.filter(Boolean)
				.join('/');
			if (uploadStatusText) {
				uploadStatusText.textContent = `Uploading ${index + 1} of ${selectedUploads.length}…`;
			}
			const formData = new FormData();
			formData.append('file', file, file.name);
			const query = directoryPath
				? `?path=${encodeURIComponent(directoryPath)}`
				: '';
			const response = await fetch(`/api/files${query}`, {
				method: 'POST',
				headers: { 'x-file-size': String(file.size) },
				body: formData
			});
			if (response.status === 401) {
				window.location.assign('/login');
				return;
			}
			if (!response.ok) {
				let message = `Unable to upload ${file.name}`;
				try {
					const body = (await response.json()) as {
						message?: string;
					};
					if (body.message) message = body.message;
				} catch {
					// Keep the default upload error when the response is not JSON.
				}
				throw new Error(message);
			}
		}

		clearSelectedFiles();
		setUploading(false);
		closeModal();
		showToast('Upload complete.');
		await Promise.all([loadStorage(), loadStorageUsage()]);
	} finally {
		setUploading(false);
	}
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
		case 'toggle-theme':
			applyTheme(
				document.documentElement.dataset['theme'] === 'dark'
					? 'light'
					: 'dark'
			);
			break;
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
		case 'view-contents':
			if (selectedItem?.type === 'file') void viewContents(selectedItem);
			break;
		case 'share':
			if (selectedItem?.type === 'file') {
				void share(selectedItem).catch((error: unknown) =>
					showToast(
						error instanceof Error
							? error.message
							: 'Unable to create share link.'
					)
				);
			}
			break;
		case 'download-selected':
			downloadSelected();
			break;
		case 'delete':
			if (selectedItem) {
				const item = selectedItem;
				const label =
					item.type === 'directory'
						? 'folder and all its files'
						: 'file';
				if (window.confirm(`Delete this ${label}?`)) {
					void deleteItem(item).catch((error: unknown) =>
						showToast(
							error instanceof Error
								? error.message
								: 'Unable to delete item.'
						)
					);
				}
			}
			break;
		case 'delete-selected':
			void deleteSelected().catch((error: unknown) =>
				showToast(
					error instanceof Error
						? error.message
						: 'Unable to delete items.'
				)
			);
			break;
		case 'refresh':
			void Promise.all([loadStorage(), loadStorageUsage()]);
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
selectAll?.addEventListener('change', () => {
	for (const item of visibleItems()) {
		if (item.virtual) continue;
		if (selectAll.checked) selectedPaths.add(item.path);
		else selectedPaths.delete(item.path);
	}
	renderItems();
});
fileInput?.addEventListener('change', () => {
	updateSelectedFiles(filesToUploads(fileInput.files));
});
folderInput?.addEventListener('change', () => {
	updateSelectedFiles(filesToUploads(folderInput.files), true);
});

let dragDepth = 0;

dropZone?.addEventListener('dragenter', (event) => {
	event.preventDefault();
	dragDepth += 1;
	dropZone.classList.add('drag-over');
});

dropZone?.addEventListener('dragover', (event) => {
	event.preventDefault();
	if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
});

dropZone?.addEventListener('dragleave', (event) => {
	event.preventDefault();
	dragDepth = Math.max(0, dragDepth - 1);
	if (dragDepth === 0) dropZone.classList.remove('drag-over');
});

dropZone?.addEventListener('drop', (event) => {
	event.preventDefault();
	dragDepth = 0;
	dropZone.classList.remove('drag-over');

	const dataTransfer = event.dataTransfer;
	if (!dataTransfer) return;

	void readDroppedItems(dataTransfer)
		.then((files) => {
			if (files.length > 0) updateSelectedFiles(files, true);
		})
		.catch(() => showToast('Unable to read the dropped folder.'));
});

previewImage?.addEventListener('click', openImagePreview);
previewVideo?.addEventListener('click', openVideoPreview);
previewPlay?.addEventListener('click', openVideoPreview);

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
	void loadStorageUsage().catch((error: unknown) =>
		showToast(error instanceof Error ? error.message : 'Unable to load storage usage.')
	);
} else {
	window.location.replace('/login');
}
