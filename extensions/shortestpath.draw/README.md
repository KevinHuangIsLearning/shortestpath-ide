# ShortestPath Sketchpad

The fourth navigation tab embeds Excalidraw locally. Scripts, translations and fonts
ship with the IDE; drawing requires no account, server or network connection.

The library starts with 16 editable competition templates: arrays, indexed grids,
binary trees, a linked list, a key-value table, undirected graphs, coordinate axes,
a number line, a Venn diagram, a triangle and a hexagon. Templates use consistent
outline styling and localized names. Existing custom library items are kept;
templates are seeded once per saved draft and removing them is remembered.
The online library browser and publishing actions are hidden. Local library
import/export and adding canvas selections to the library remain available.
Template sources and their MIT license are recorded in `THIRD_PARTY_NOTICES.txt`.

Drafts autosave under the extension's workspace storage, or its global storage when
no folder is open. "Draw beside Code" opens the same draft alongside editor groups.
New Draft and Import require confirmation before replacing the saved scene. Drawings
can be exported as `.excalidraw`, PNG or SVG using native file dialogs. The Export
button opens a menu; choosing a format starts that export directly.

Run `npm ci`, `npm test` and `npm run typecheck` in this directory. The repository's
`compile-oi-extensions` command builds the extension and its offline Webview assets.
