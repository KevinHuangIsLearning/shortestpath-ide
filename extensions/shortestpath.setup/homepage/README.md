# Home

`public/index.html` is the complete distributed page. Its CSS, JavaScript, countdown targets and motivational copy are inline. Configure `homepageSource` in `src/homepage.ts` before building: `owner`, `repository`, `ref` and `file` identify the published HTML. The updater requests GitHub first and tries GitCode if that download fails. Both raw URL forms are provided in `homepageSourceUrls`. GitCode requires a published repository there; its default coordinates are a template, not a provisioned mirror. There is no user setting for the source, resource archive or separate content/manifest JSON. Until the file is published, failed update checks retain the bundled/cached page.

Favorite icons reuse the browser's saved image data URIs. Home never requests favorite websites or `/favicon.ico`; missing icons display initials. The server does not inject a CSP.

The extension starts a loopback server on demand. The workbench displays it in the independent Home mode, with native editor tabs and the address bar hidden. Home is excluded from Dark Reader. Ordinary browser tabs keep their own settings and state.

When serving HTML, the IDE injects:

- Current IDE theme variables and UI fonts, with theme changes reflected locally.
- `window.shortestpath.initialData`: live browser favorites, recent items, Dashboard heatmap and local calendar/time. The HTML decides how to render these fields.
- `window.shortestpath.executeCommand(id, ...args)`: an allowlisted command bridge. The registered command IDs are the same ones used by native IDE actions. Add commands to the map in `src/homepage.ts` when exposing more functionality.

The default HTML has two columns. The left side shows greetings, two countdowns and motivational text; the right side shows browser favorites and the Dashboard heatmap, with a hidden `data-slot="study-plan"` for future integration. The heatmap uses the same record normalization and time range as the Dashboard.

The updater checks the direct HTML URL at server startup and every 12 hours. It downloads to a staging directory, validates the document and assigns a content hash. A pending update takes effect on the next entry to Home; activation removes previous cached HTML versions. Failed downloads retain the current page. The installed `public/index.html` remains the offline fallback.

NOIP 2026 uses the [official November 28 date](https://noi.cn/xw/2026-10-12/938849.shtml). The bundled NOI 2027 target has no speculative date. Countdown targets and dates are owned exclusively by the distributed HTML. The IDE supplies the current time; there is no user configuration or local override.

Build: `npm run compile` in the extension directory. Bridge/update checks: `node --test homepage/server.test.cjs`.
