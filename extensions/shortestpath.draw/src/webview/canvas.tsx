/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, MainMenu, WelcomeScreen, exportToBlob, exportToSvg, restore, restoreLibraryItems, serializeAsJSON, serializeLibraryAsJSON } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI, ExcalidrawProps, LibraryItems } from '@excalidraw/excalidraw/types';
import { initializeCompetitionLibrary, serializeCompetitionLibrary } from '../competitionLibrary';
import { ClientMessage, DraftSnapshot, HostMessage } from '../protocol';
import { DrawStrings, getDrawStrings } from '../strings';
import { SaveSession, SaveStatus } from './saveSession';
import { DrawingExportFormat, ExportMenu } from './exportMenu';

declare function acquireVsCodeApi(): { postMessage(message: ClientMessage): void };
const vscode = acquireVsCodeApi();
const post = (message: ClientMessage) => vscode.postMessage(message);

function Canvas({ snapshot, language, theme, session, onApi }: { snapshot?: DraftSnapshot; language: string; theme: 'light' | 'dark'; session: SaveSession; onApi: (api: ExcalidrawImperativeAPI, getSnapshot: () => DraftSnapshot) => void }) {
	const data = useMemo(() => restore(snapshot ? JSON.parse(snapshot.scene) : null, null, null), [snapshot]);
	const initialLibrary = useMemo(() => restoreLibraryItems(initializeCompetitionLibrary(snapshot?.library, language), 'unpublished'), [snapshot, language]);
	const library = useRef<LibraryItems>(initialLibrary);
	const api = useRef<ExcalidrawImperativeAPI>();
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
		session.change({ scene: serializeAsJSON(elements, appState, files, 'local'), library: serializeCompetitionLibrary(library.current) });
	};
	return <Excalidraw initialData={initialData} theme={theme} langCode={language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'} autoFocus aiEnabled={false} validateEmbeddable={false}
		excalidrawAPI={value => { api.current = value; onApi(value, serialize); }} onChange={onChange}
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
			if (message.type === 'theme') { setTheme(message.theme); }
			else if (message.type === 'saved') { session.acknowledge(message.revision, message.error); }
			else if (message.type === 'init' || message.type === 'replace') {
				setError(message.error);
				if (!message.error) { setStatus('saved'); setDocument(previous => ({ snapshot: message.snapshot, generation: (previous?.generation ?? 0) + 1 })); }
			}
		};
		const flush = () => session.flush();
		window.addEventListener('message', receive);
		window.addEventListener('pagehide', flush);
		globalThis.document.addEventListener('visibilitychange', flush);
		post({ type: 'ready' });
		return () => {
			window.removeEventListener('message', receive);
			window.removeEventListener('pagehide', flush);
			globalThis.document.removeEventListener('visibilitychange', flush);
			session.dispose();
		};
	}, [session]);
	const action = (type: 'clear' | 'import' | 'openBeside' | 'openMode') => {
		if (!getSnapshot.current) { return; }
		session.flush();
		post({ type, snapshot: getSnapshot.current() });
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
	const companion = container.dataset.companion === 'true';
	return <main className="sketchpad">
		<header className="sketchpad-header">
			<strong>{strings.title}</strong>
			<span role="status" className={status === 'failed' ? 'save-status error' : 'save-status'}>{!document ? strings.loading : status === 'failed' ? strings.saveFailed : status === 'saving' ? strings.saving : strings.saved}</span>
			{status === 'failed' && <button onClick={() => session.retry()}>{strings.retry}</button>}
			<div className="sketchpad-actions">
				<button disabled={!document} onClick={() => action('clear')}>{strings.clear}</button>
				<button disabled={!document} onClick={() => action('import')}>{strings.import}</button>
				<ExportMenu strings={strings} disabled={!document} onExport={format => { void exportDrawing(format); }} />
				<button disabled={!document} onClick={() => action(companion ? 'openMode' : 'openBeside')}>{companion ? strings.mode : strings.beside}</button>
			</div>
		</header>
		{error && <div role="alert" className="sketchpad-error">{error}<button onClick={() => { setError(undefined); if (document) { void exportDrawing(lastExportFormat.current); } else { post({ type: 'ready' }); } }}>{strings.retry}</button></div>}
		<section className="sketchpad-canvas" aria-label={strings.title} data-i18n-ignore>
			{document && <Canvas key={document.generation} snapshot={document.snapshot} language={container.dataset.language!} theme={theme} session={session} onApi={(value, serialize) => { api.current = value; getSnapshot.current = serialize; }} />}
		</section>
	</main>;
}

export function mount(container: HTMLElement): void { createRoot(container).render(<Sketchpad container={container} />); }
