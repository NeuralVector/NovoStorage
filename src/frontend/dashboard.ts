// The dashboard is a browser application that renders the file table and handles UI events.
import { getCurrentUserName, isSignedIn, signOut } from './auth.ts';

interface StorageItem {
	// This is the normalized shape used by every file-table row, regardless of
	// whether the row came from the user's own S3 objects or a shared reference.
	name: string;
	path: string;
	type: 'file' | 'directory';
	size: number;
	lastModified: string | null;
	owner: string;
	referenceId?: string;
}

interface StorageUsage {
	// The quota response contains raw byte counts; formatting happens only at the UI boundary.
	usedBytes: number;
	quotaBytes: number;
	remainingBytes: number;
}

interface SelectedUpload {
	// A File object contains bytes, while relativePath preserves a dropped folder's structure.
	file: File;
	relativePath: string;
}

interface DroppedEntry {
	// This describes the subset of the non-standard WebKit drag-and-drop entry API we use.
	isFile: boolean;
	isDirectory: boolean;
	name: string;
	file?: (onFile: (file: File) => void, onError?: (error: unknown) => void) => void;
	createReader?: () => DroppedDirectoryReader;
}

interface DroppedDirectoryReader {
	// Directory readers return batches, so callers must continue until an empty batch is received.
	readEntries: (
		onEntries: (entries: DroppedEntry[]) => void,
		onError?: (error: unknown) => void
	) => void;
}

// Cache the DOM nodes once so rendering functions do not repeatedly search the document.
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

// These variables are the dashboard's small in-memory state store. The server remains the
// source of truth; this state only controls the current view and avoids unnecessary requests.
let storageItems: StorageItem[] = [];
let selectedItem: StorageItem | null = null;
let selectedPaths = new Set<string>();
let currentPath = '';
let currentView: 'storage' | 'shared' = 'storage';
let previewUrl: string | null = null;
let previewRequest = 0;
let contentsRequest = 0;
let selectedUploads: SelectedUpload[] = [];
let isUploading = false;

function applyTheme(theme: 'light' | 'dark'): void {
	// Apply the data attribute consumed by the CSS theme selectors and persist the choice.
	document.documentElement.dataset['theme'] = theme;
	localStorage.setItem('novostorage-theme', theme);
	if (themeToggle) {
		// Update both icon visibility and accessible button text to describe the action available next.
		const nextTheme = theme === 'dark' ? 'light' : 'dark';
		moonIcon?.toggleAttribute('hidden', theme === 'dark');
		sunIcon?.toggleAttribute('hidden', theme !== 'dark');
		themeToggle.setAttribute('aria-pressed', String(theme === 'dark'));
		themeToggle.setAttribute('aria-label', `Enable ${nextTheme} mode`);
		themeToggle.title = `Enable ${nextTheme} mode`;
	}
}

const savedTheme = localStorage.getItem('novostorage-theme');
// Unknown or missing values intentionally fall back to the light theme.
applyTheme(savedTheme === 'dark' ? 'dark' : 'light');

function renderBreadcrumb(): void {
	// Rebuild the breadcrumb buttons from the current folder path. Rebuilding is simpler and safer
	// than trying to update individual crumbs when the user changes folders or switches views.
	if (!breadcrumb) return;
	breadcrumb.replaceChildren();
	const root = document.createElement('button');
	root.type = 'button';
	root.textContent = currentView === 'shared' ? 'Shared with me' : 'My storage';
	root.dataset['path'] = '';
	root.addEventListener('click', () => navigateTo(''));
	breadcrumb.append(root);

	const allFilesSeparator = document.createElement('b');
	allFilesSeparator.textContent = '›';
	breadcrumb.append(allFilesSeparator);
	const allFiles = document.createElement('button');
	allFiles.type = 'button';
	allFiles.textContent = currentView === 'shared' ? 'Shared files' : 'All files';
	allFiles.dataset['path'] = '';
	allFiles.addEventListener('click', () => navigateTo(''));
	breadcrumb.append(allFiles);

	const parts = currentPath.split('/').filter(Boolean);
	let path = '';
	for (const part of parts) {
		// Each iteration turns the path prefix into a button, e.g. a/b becomes a then a/b.
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
	// Convert raw byte counts into a readable unit such as MB or GB. Logarithms select the
	// largest sensible unit, while the cap prevents unexpectedly large values from indexing past TB.
	if (bytes === 0) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
	return `${(bytes / 1024 ** unitIndex).toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatLastModified(value: string | null): string {
	// Dates come from JSON as strings, so parse them locally and use the browser's locale for display.
	if (!value) return '—';
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '—';
	return new Intl.DateTimeFormat(undefined, {
		dateStyle: 'medium',
		timeStyle: 'short'
	}).format(date);
}

function showToast(message: string): void {
	// Toasts are transient status messages; replacing the text also resets the visible message timer.
	if (!toast) return;
	toast.textContent = message;
	toast.hidden = false;
	window.setTimeout(() => {
		toast.hidden = true;
	}, 3000);
}

function renderStorageUsage(usage: StorageUsage): void {
	// Keep the percentage bounded because malformed or already-full responses should not widen the bar.
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
	// Quota is loaded separately so the usage bar can update independently of the file-table request.
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
	// Downloads use a temporary browser link so authentication, streaming, and save behavior remain
	// handled by the server/browser instead of loading the entire object into JavaScript memory.
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
	// Read text progressively from the response instead of buffering the whole file. The request
	// counter prevents a slower, older request from overwriting a newer modal selection.
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
		// Respect a server-provided charset when possible, but retain UTF-8 for unknown charsets.
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
				// Appending chunks as they arrive makes large text files usable before download completes.
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
	// Ask the API to create a share link, then copy it to the clipboard. The prompt fallback supports
	// browsers or permission settings where navigator.clipboard is unavailable.
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
	// Only direct children of the current folder are shown in the table; descendants remain available
	// in memory for folder navigation and recursive operations.
	const search = filter?.value.trim().toLowerCase() ?? '';
	const prefix = currentPath ? `${currentPath}/` : '';
	return storageItems.filter((item) => {
		if (currentView === 'shared' && !item.referenceId) return false;
		if (!item.path.startsWith(prefix) || item.path === currentPath) return false;
		const relativePath = item.path.slice(prefix.length);
		return (
			relativePath.split('/').filter(Boolean).length === 1 &&
			item.name.toLowerCase().includes(search)
		);
	});
}

function selectedStorageItems(): StorageItem[] {
	// Selection is stored as paths so a rerender can recreate checkboxes without losing it.
	return storageItems.filter((item) => selectedPaths.has(item.path));
}

function updateSelectionUi(items = visibleItems()): void {
	// The header checkbox represents only the currently visible rows, while the Set may include rows
	// from another folder that the user selected earlier.
	const selectedCount = selectedStorageItems().length;
	if (selectionActions) selectionActions.hidden = selectedCount === 0;
	if (selectionCount) {
		selectionCount.textContent = `${selectedCount} selected`;
	}
	if (selectAll) {
		const selectedVisibleCount = items.filter((item) =>
			selectedPaths.has(item.path)
		).length;
		selectAll.checked = items.length > 0 && selectedVisibleCount === items.length;
		selectAll.indeterminate =
			selectedVisibleCount > 0 && selectedVisibleCount < items.length;
	}
}

function clearSelection(): void {
	// Navigation and view changes clear selection because paths have different meaning in the new view.
	selectedPaths.clear();
	updateSelectionUi();
}

function downloadSelected(): void {
	// Expand selected directories into their descendant files and deduplicate files shared by selections.
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
	// The API accepts one path and deletes either that file or the complete directory subtree.
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
	// Batch deletion intentionally sends independent requests so one selected path maps to one API action.
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
	// Preview support is deliberately allow-listed by extension rather than trusting arbitrary content.
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
	// This list mirrors the formats the browser video element can request from the streaming endpoint.
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
	// Include the reference ID when needed so a shared object is authorized as the recipient's item.
	const query = new URLSearchParams({ path: item.path });
	if (item.referenceId) query.set('referenceId', item.referenceId);
	return `/api/files/stream?${query.toString()}`;
}

function resetPreview(): void {
	// Invalidate pending preview work, release blob memory, and hide every preview presentation mode.
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
	// Images are fetched as blobs so they can be displayed in the details panel without exposing a
	// permanent object URL; videos use the range-capable streaming endpoint directly.
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
		// Let the video element fetch metadata/data itself so seeking and range requests keep working.
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
		// Fetch the image through the authenticated API, then create a short-lived local object URL.
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
	// Selecting a row opens the details panel, fills its metadata, and starts a possible preview.
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
	const detailOwner = document.querySelector('#detail-owner');
	if (detailOwner) detailOwner.textContent = item.owner;
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
	// Folder navigation only changes browser state; the full list is already loaded, so no network
	// request is necessary until a refresh or mutation occurs.
	currentPath = path;
	selectedItem = null;
	clearSelection();
	resetPreview();
	if (detailsPanel) detailsPanel.hidden = true;
	appShell?.classList.remove('has-details');
	renderBreadcrumb();
	renderItems();
}

function setView(view: 'storage' | 'shared'): void {
	// Switching views resets folder-local UI because shared references and owned paths are separate sets.
	currentView = view;
	for (const button of document.querySelectorAll<HTMLButtonElement>('[data-view]')) {
		button.classList.toggle('active', button.dataset['view'] === view);
	}
	currentPath = '';
	selectedItem = null;
	clearSelection();
	resetPreview();
	if (detailsPanel) detailsPanel.hidden = true;
	appShell?.classList.remove('has-details');
	if (detailsEmpty) detailsEmpty.hidden = false;
	if (detailsContent) detailsContent.hidden = true;
	const pageTitle = document.querySelector<HTMLElement>('#page-title');
	const pageDescription = document.querySelector<HTMLElement>('#page-description');
	if (pageTitle) pageTitle.textContent = view === 'shared' ? 'Shared with me' : 'My storage';
	if (pageDescription) {
		pageDescription.textContent =
			view === 'shared'
				? 'Files shared with you by other people.'
				: 'Upload files to start organizing your workspace.';
	}
	renderBreadcrumb();
	renderItems();
}

function emptyState(): HTMLElement {
	// Build empty content in code so the message and action match the active storage/shared view.
	const empty = document.createElement('div');
	empty.className = 'empty-state';
	if (currentView === 'shared') {
		empty.innerHTML =
			'<div class="empty-icon">↗</div><h2>No shared files</h2><p>Files shared with you will appear here.</p>';
		return empty;
	}
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
	// Return a fresh node because renderItems replaces the table contents during every load.
	const loading = document.createElement('div');
	loading.className = 'loading-state';
	loading.innerHTML =
		'<span class="loading-spinner" aria-hidden="true"></span><p>Loading your files...</p>';
	return loading;
}

function setLoading(): void {
	// Show immediate feedback before fetch resolves, avoiding a stale table during refresh.
	if (fileRows) fileRows.replaceChildren(loadingState());
	if (itemCount) itemCount.textContent = 'Loading...';
}

function setLoadError(): void {
	// Render an actionable but deliberately generic error state; detailed errors are shown as toasts.
	if (!fileRows) return;
	const error = document.createElement('div');
	error.className = 'empty-state';
	error.innerHTML =
		'<div class="empty-icon">!</div><h2>Unable to load files</h2><p>Try refreshing the page.</p>';
	fileRows.replaceChildren(error);
}

function renderItems(): void {
	// Render the visible slice from state. Event handlers are attached here because rows are recreated.
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
		// Each row is assembled with DOM APIs so file names are treated as text, not executable HTML.
		const row = document.createElement('div');
		row.className = 'file-row';
		row.dataset['path'] = item.path;
		row.setAttribute('role', 'row');
		const checkbox = document.createElement('input');
		checkbox.className = 'select-item';
		checkbox.type = 'checkbox';
		checkbox.checked = selectedPaths.has(item.path);
		checkbox.setAttribute('aria-label', `Select ${item.name}`);
		checkbox.addEventListener('change', () => {
			// Mutate only the path Set, then rerender so checkbox and header state stay synchronized.
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
			// Directories navigate; files select, because only files can be previewed/downloaded.
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
		action.setAttribute('aria-label', actionName);
		action.title = actionName;
		action.innerHTML =
			item.type === 'file'
				? '<svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0 4-4m-4 4-4-4M5 21h14" /></svg>'
				: '<svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16m-11 0V4h6v3m-9 0 1 14h10l1-14m-7 4v6m4-6v6" /></svg>';
		action.addEventListener('click', () => {
			// The row's secondary action is download for files and recursive delete for folders.
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
	// Wait for the API response before replacing the loading state with rows, while retaining only
	// selections that still exist after a refresh.
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
	// All modal types share one backdrop, so opening one always makes that backdrop visible too.
	if (!modalBackdrop || !modal) return;
	modalBackdrop.hidden = false;
	modal.hidden = false;
}

function renderSelectedFiles(files: SelectedUpload[]): void {
	// Rebuild the upload queue display from state; this also handles the empty queue consistently.
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
	// Convert the browser's array-like FileList into the richer upload model used by the queue.
	return [...(files ?? [])].map((file) => ({
		file,
		relativePath:
			(file as File & { webkitRelativePath?: string }).webkitRelativePath ?? ''
	}));
}

function updateSelectedFiles(files: SelectedUpload[], append = false): void {
	// File selection replaces the queue; folder selection and drag/drop can opt into appending instead.
	selectedUploads = append ? [...selectedUploads, ...files] : files;
	renderSelectedFiles(selectedUploads);
}

function readDroppedFile(entry: DroppedEntry, directoryPath: string): Promise<SelectedUpload> {
	// Wrap the callback-only entry API in a Promise so recursive directory traversal can use await.
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
	// Read every batch from the directory reader, recursively preserving each child's relative path.
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
	// Prefer entries because ordinary FileList data loses folder hierarchy during a drop.
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
	// Reset both native inputs and our queue because browsers do not reliably fire change for the same file twice.
	if (fileInput) fileInput.value = '';
	if (folderInput) folderInput.value = '';
	selectedUploads = [];
	renderSelectedFiles(selectedUploads);
}

function setUploading(uploading: boolean): void {
	// Lock controls while requests are in flight so the same queue cannot be submitted twice.
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
	// Close every modal and cancel UI work associated with it; an active upload is the one exception.
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
	// Copy the small preview into the full-screen modal without refetching the image.
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
	// Reuse the authenticated stream URL in a larger video element and attempt autoplay when permitted.
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
	// Upload each selected file sequentially so progress text remains understandable and quota checks
	// can account for the complete queue before any bytes are sent.
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
			// Normalize browser-specific separators and combine the dropped path with the current folder.
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
			// Multipart handles the file stream; the explicit size header lets the server reserve quota first.
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
	// Directories are created through the API as S3 directory-marker objects, since S3 has no native folders.
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
	// One delegated listener handles buttons created both by HTML and TypeScript, including future empty-state buttons.
	const target = event.target as HTMLElement;
	const action = target.closest<HTMLElement>('[data-action]')?.dataset['action'];
	if (!action) return;

	switch (action) {
		case 'toggle-theme':
			// Toggle from the current document state rather than from a stale local variable.
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
			// The create menu is intentionally independent from modal state.
			const menu = document.querySelector<HTMLElement>('.create-menu');
			if (menu) menu.hidden = !menu.hidden;
			break;
		}
		case 'open-upload':
			if (currentView === 'shared') setView('storage');
			openModal(uploadModal);
			break;
		case 'open-folder':
			if (currentView === 'shared') setView('storage');
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
			// Confirm destructive actions at the last possible moment, after the selected item is known.
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
			// Refresh both independent server-backed summaries together.
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
	// Pointer events allow mouse, pen, and touch dragging to share the same resize implementation.
	event.preventDefault();
	const resize = (moveEvent: PointerEvent): void => {
		// Clamp the panel so it remains usable without consuming the entire viewport.
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
	// Select or deselect only rows visible under the active folder, view, and filter.
	for (const item of visibleItems()) {
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
		setView(button.dataset['view'] === 'shared' ? 'shared' : 'storage');
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
