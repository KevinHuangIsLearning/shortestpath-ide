# Home

`remote_configurations/homepage/index.html` at the repository root is the complete distributed page. Its CSS, JavaScript, countdown targets and motivational copy are inline. Setup compilation copies it to `homepage/public/index.html` as the installed offline default; edit only the source in `remote_configurations`. Configure repository coordinates in `src/homepage.ts` before building. Both the page and feature flags request GitHub first and try GitCode if that request fails. GitCode requires a published mirror there. There is no user setting for the source or resource archive.

Home is enabled only when the remote `remote_configurations/configurations/features.json` contains `"homepage": true`. Missing fields, non-boolean values, malformed files and failure of both sources disable Home. The committed default is false. Flags are fetched when Setup activates and every 12 hours, without persisting an enabled value offline. Disabled Home hides navigation and command entries and prevents its local server from starting; disabling it while open returns to solving and closes the server.

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

Local development: launch the source IDE with `SHORTESTPATH_HOMEPAGE_DEBUG=1 ./scripts/code.sh` from the repository root. Home reads `remote_configurations/homepage/index.html` on every navigation, so edit the HTML and re-enter Home without rebuilding. Real IDE data and theme injection remain active. Source builds only; the environment variable cannot enable Home in packaged builds.
