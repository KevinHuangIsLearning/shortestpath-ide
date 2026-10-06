export type DroppedFile = { name: string; base64: string };

/** Workbench drags carry resource URIs; native browser File objects need content transfer. */
export function droppedPaths(transfer: DataTransfer): string[] {
	for (const type of ['CodeFiles', 'ResourceURLs']) {
		try {
			const values = JSON.parse(transfer.getData(type));
			if (Array.isArray(values) && values.every(value => typeof value === 'string')) { return values; }
		} catch { /* Try the next supported transfer format. */ }
	}
	const uris = transfer.getData('text/uri-list').split(/\r?\n/).filter(value => value && !value.startsWith('#'));
	if (uris.length) { return uris; }
	const paths = Array.from(transfer.files).map(file => (file as File & { path?: string }).path).filter((value): value is string => !!value);
	if (paths.length) { return paths; }
	const text = transfer.getData('text/plain').trim();
	return /^(file:|\/|[A-Za-z]:[\\/])/.test(text) ? [text] : [];
}

export async function droppedContents(transfer: DataTransfer): Promise<{ files: DroppedFile[]; folder: boolean }> {
	// Capture entries synchronously: browsers clear DataTransfer after the drop event returns.
	const entries = Array.from(transfer.items).map(item => item.webkitGetAsEntry()).filter((entry): entry is FileSystemEntry => !!entry);
	const rawFiles = Array.from(transfer.files);
	const files: DroppedFile[] = [];
	let bytes = 0, count = 0;
	const add = async (file: File, name: string) => {
		bytes += file.size;
		if (++count > 10000 || bytes > 128 * 1024 * 1024) { throw new Error('dropTooLarge'); }
		const base64 = await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result).split(',')[1]);
			reader.onerror = () => reject(new Error('dropReadFailed'));
			reader.readAsDataURL(file);
		});
		files.push({ name, base64 });
	};
	let entryCount = 0;
	const visit = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
		if (++entryCount > 10000) { throw new Error('dropTooLarge'); }
		const name = prefix + entry.name;
		if (entry.isFile) {
			const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
			await add(file, name);
		} else if (entry.isDirectory) {
			const reader = (entry as FileSystemDirectoryEntry).createReader();
			for (;;) {
				const children = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
				if (!children.length) { break; }
				for (const child of children) { await visit(child, name + '/'); }
			}
		}
	};
	if (entries.length) { for (const entry of entries) { await visit(entry, ''); } }
	else { for (const file of rawFiles) { await add(file, file.name); } }
	return { files, folder: entries.some(entry => entry.isDirectory) };
}

/** Claim the drag before the Webview host forwards it to the workbench and disables its iframe. */
export function claimTestcaseDrag(event: { preventDefault(): void; stopPropagation(): void; dataTransfer: DataTransfer }): void {
	event.preventDefault();
	event.stopPropagation();
	event.dataTransfer.dropEffect = 'copy';
}
