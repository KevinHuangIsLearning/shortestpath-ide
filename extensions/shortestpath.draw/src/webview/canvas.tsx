/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, MainMenu, WelcomeScreen, exportToBlob, exportToSvg, restore, restoreLibraryItems, serializeAsJSON, serializeLibraryAsJSON } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI, ExcalidrawProps, LibraryItems } from '@excalidraw/excalidraw/types';
import { initializeCompetitionLibrary, serializeCompetitionLibrary } from '../competitionLibrary';
import { ClientMessage, DraftSnapshot, DrawingExportFormat, FileAction, HostMessage } from '../protocol';
import { DrawStrings, getDrawStrings } from '../strings';
import { SaveSession, SaveStatus } from './saveSession';

declare function acquireVsCodeApi(): { postMessage(message: ClientMessage): void; setState(state: { fileId?: string }): void };
const vscode = acquireVsCodeApi();
const post = (message: ClientMessage) => vscode.postMessage(message);

function Canvas({ snapshot, language, theme, session, onApi, onReady }: { snapshot?: DraftSnapshot; language: string; theme: 'light' | 'dark'; session: SaveSession; onApi: (api: ExcalidrawImperativeAPI, getSnapshot: () => DraftSnapshot) => void; onReady?: () => void }) {
	const data = useMemo(() => restore(snapshot ? JSON.parse(snapshot.scene) : null, null, null), [snapshot]);
	const initialLibrary = useMemo(() => restoreLibraryItems(initializeCompetitionLibrary(snapshot?.library, language), 'unpublished'), [snapshot, language]);
	const library = useRef<LibraryItems>(initialLibrary);
	const api = useRef<ExcalidrawImperativeAPI>();
	const ready = useRef(false);
	const notifyReady = () => {
		if (api.current && !api.current.getAppState().isLoading && !ready.current) { ready.current = true; onReady?.(); }
	};
	useEffect(() => {
		let frame: number;
		const check = () => {
			notifyReady();
			if (!ready.current) { frame = requestAnimationFrame(check); }
		};
		frame = requestAnimationFrame(check);
		return () => cancelAnimationFrame(frame);
	}, []);
	const serialize = (): DraftSnapshot => {
		const current = api.current;
		// The API can exist before the asynchronous initial scene has been restored.
		const scene = current && !current.getAppState().isLoading
			? serializeAsJSON(current.getSceneElements(), current.getAppState(), current.getFiles(), 'local')
			: serializeAsJSON(data.elements, data.appState, data.files, 'local');
		return { scene, library: serializeCompetitionLibrary(library.current) };
	};
	const initialData = useMemo(() => {
		session.accept({ scene: serializeAsJSON(data.elements, data.appState, data.files, 'local'), library: snapshot?.library ?? serializeLibraryAsJSON([]) }, false);
		return { ...data, libraryItems: library.current };
	}, [data, session]);
	useEffect(() => {
		// Save the seeded library without requiring a canvas edit, including its removal marker.
		session.change({ scene: serializeAsJSON(initialData.elements, initialData.appState, initialData.files, 'local'), library: serializeCompetitionLibrary(initialData.libraryItems) });
	}, [initialData, session]);
	const onChange: NonNullable<ExcalidrawProps['onChange']> = (elements, appState, files) => {
		if (appState.isLoading) { return; }
		session.change({ scene: serializeAsJSON(elements, appState, files, 'local'), library: serializeCompetitionLibrary(library.current) });
		notifyReady();
	};
	return <Excalidraw initialData={initialData} theme={theme} langCode={language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'} autoFocus aiEnabled={false} validateEmbeddable={false}
		excalidrawAPI={value => { api.current = value; onApi(value, serialize); notifyReady(); }} onChange={onChange}
		onLibraryChange={items => { library.current = items; if (api.current) { session.change(serialize()); } }}
		onLinkOpen={(_element, event) => event.preventDefault()}
		UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, saveAsImage: false, clearCanvas: false, export: false, toggleTheme: false } }}>
		<MainMenu><MainMenu.DefaultItems.ChangeCanvasBackground /><MainMenu.DefaultItems.Help /></MainMenu>
		<WelcomeScreen><WelcomeScreen.Center><WelcomeScreen.Center.Heading>{getDrawStrings(language).empty}</WelcomeScreen.Center.Heading></WelcomeScreen.Center></WelcomeScreen>
	</Excalidraw>;
}

function Sketchpad({ container }: { container: HTMLElement }) {
	const strings: DrawStrings = getDrawStrings(container.dataset.language!);
	const [theme, setTheme] = useState<'light' | 'dark'>(container.dataset.theme === 'light' ? 'light' : 'dark');
	const [document, setDocument] = useState<{ snapshot?: DraftSnapshot; generation: number }>();
	const [error, setError] = useState<string>();
	const [status, setStatus] = useState<SaveStatus>('saved');
	const lastExportFormat = useRef<DrawingExportFormat>('excalidraw');
	const [session] = useState(() => new SaveSession(post));
	const api = useRef<ExcalidrawImperativeAPI>();
	const getSnapshot = useRef<() => DraftSnapshot>();
	useEffect(() => {
		session.onStatus = setStatus;
		const receive = (event: MessageEvent<HostMessage>) => {
			const message = event.data;
			if (message.type === 'documentAction') {
				if (message.action === 'export') { void exportDrawing(message.format ?? 'excalidraw'); }
				else { action(message.action); }
			}
			else if (message.type === 'fileAction') { fileAction(message.action, message.id); }
			else if (message.type === 'theme') { setTheme(message.theme); }
			else if (message.type === 'saved') { session.acknowledge(message.revision, message.error); }
			else if (message.type === 'init' || message.type === 'replace') {
				setError(message.error);
				if (!message.error) { api.current = undefined; getSnapshot.current = undefined; session.accept(message.snapshot ?? { scene: '{"type":"excalidraw","elements":[]}', library: '{"type":"excalidrawlib","libraryItems":[]}' }); session.fileId = message.fileId; vscode.setState({ fileId: message.fileId }); setStatus('saved'); setDocument(previous => ({ snapshot: message.snapshot, generation: (previous?.generation ?? 0) + 1 })); }
			}
		};
		const pointers = new Set<number>();
		const releasePointers = () => { pointers.clear(); session.activity(false); };
		const flush = () => { releasePointers(); session.flush(); };
		const pointerDown = (event: PointerEvent) => { pointers.add(event.pointerId); session.activity(true); };
		const pointerUp = (event: PointerEvent) => { pointers.delete(event.pointerId); session.activity(pointers.size > 0); };
		const activity = () => session.activity();
		container.addEventListener('pointerdown', pointerDown, true);
		window.addEventListener('pointerup', pointerUp, true);
		window.addEventListener('pointercancel', pointerUp, true);
		window.addEventListener('blur', releasePointers);
		container.addEventListener('keydown', activity, true);
		container.addEventListener('input', activity, true);
		container.addEventListener('wheel', activity, true);
		window.addEventListener('message', receive);
		window.addEventListener('pagehide', flush);
		globalThis.document.addEventListener('visibilitychange', flush);
		post({ type: 'ready' });
		return () => {
			container.removeEventListener('pointerdown', pointerDown, true);
			window.removeEventListener('pointerup', pointerUp, true);
			window.removeEventListener('pointercancel', pointerUp, true);
			window.removeEventListener('blur', releasePointers);
			container.removeEventListener('keydown', activity, true);
			container.removeEventListener('input', activity, true);
			container.removeEventListener('wheel', activity, true);
			window.removeEventListener('message', receive);
			window.removeEventListener('pagehide', flush);
			globalThis.document.removeEventListener('visibilitychange', flush);
			session.dispose();
		};
	}, [session, container]);
	const action = (type: 'clear' | 'import' | 'openBeside' | 'openMode') => {
		if (!getSnapshot.current) { return; }
		session.flush();
		post({ type, snapshot: getSnapshot.current(), fileId: session.fileId });
	};
	const fileAction = (action: FileAction, id: string) => {
		if (!getSnapshot.current) { return; }
		session.flush();
		post({ type: 'fileAction', action, id, snapshot: getSnapshot.current(), fileId: session.fileId });
	};
	const exportDrawing = async (format: DrawingExportFormat) => {
		if (!api.current || !getSnapshot.current) { return; }
		lastExportFormat.current = format;
		try {
			session.flush();
			if (format === 'excalidraw') { post({ type: 'export', format, data: getSnapshot.current().scene }); return; }
			const options = { elements: api.current.getSceneElements(), appState: api.current.getAppState(), files: api.current.getFiles() };
			if (format === 'svg') {
				post({ type: 'export', format, data: (await exportToSvg({ ...options, exportEmbedScene: true })).outerHTML });
			} else {
				const blob = await exportToBlob({ ...options, mimeType: 'image/png', appState: { ...options.appState, exportEmbedScene: true } });
				const reader = new FileReader();
				reader.onload = () => post({ type: 'export', format, data: String(reader.result).split(',')[1] });
				reader.readAsDataURL(blob);
			}
		} catch { setError(strings.actionFailed.replace('{0}', strings.exportTitle)); }
	};
	return <main className={'sketchpad'}>
		{!document && !error && <div role={'status'} className={'sketchpad-loading'}>{strings.loading}</div>}
		{status === 'failed' && <div role={'alert'} className={'sketchpad-error'}>{strings.saveFailed}<button onClick={() => session.retry()}>{strings.retry}</button></div>}
		{error && <div role={'alert'} className={'sketchpad-error'}>{error}<button onClick={() => { setError(undefined); if (document) { void exportDrawing(lastExportFormat.current); } else { post({ type: 'ready' }); } }}>{strings.retry}</button></div>}
		<section className={'sketchpad-canvas'} aria-label={strings.title} data-i18n-ignore>
			{document && <Canvas key={document.generation} snapshot={document.snapshot} language={container.dataset.language!} theme={theme} session={session} onApi={(value, serialize) => { api.current = value; getSnapshot.current = serialize; }} onReady={() => post({ type: 'canvasReady', fileId: session.fileId })} />}
		</section>
	</main>;
}

export function mount(container: HTMLElement): void { createRoot(container).render(<Sketchpad container={container} />); }
