import fs from 'fs';
import path from 'path';

/** Stage browser-provided bytes without trusting browser-provided relative paths. */
export function stageDroppedTestcases(root: string, files: { name: string; base64: string }[]): string {
	if (!Array.isArray(files) || !files.length || files.length > 10000) { throw new Error('Invalid dropped file count'); }
	const seen = new Set<string>();
	let total = 0;
	const decoded = files.map(file => {
		if (typeof file.name !== 'string' || typeof file.base64 !== 'string' || file.name.includes('\\') || file.name.includes(':') || file.name.includes('\0') || file.name.split('/').some(part => !part || part === '.' || part === '..')) { throw new Error('Invalid dropped file path'); }
		const key = file.name.toLowerCase();
		if (seen.has(key)) { throw new Error('Duplicate dropped file path'); }
		seen.add(key);
		if (file.base64.length > 180 * 1024 * 1024 || (file.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.base64))) { throw new Error('Invalid dropped file content'); }
		const data = Buffer.from(file.base64, 'base64');
		total += data.length;
		if (total > 128 * 1024 * 1024) { throw new Error('Dropped files exceed 128 MiB'); }
		return { name: file.name, data };
	});
	fs.mkdirSync(root, { recursive: true });
	const directory = fs.mkdtempSync(path.join(root, 'drop-'));
	try {
		for (const file of decoded) {
			const destination = path.join(directory, file.name);
			fs.mkdirSync(path.dirname(destination), { recursive: true });
			fs.writeFileSync(destination, file.data);
		}
		return directory;
	} catch (error) { fs.rmSync(directory, { recursive: true, force: true }); throw error; }
}
