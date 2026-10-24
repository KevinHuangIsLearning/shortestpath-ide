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

Drawings and folders are managed in a dedicated native Activity Bar file tree: create, rename, move,
open and delete items within a fixed IDE storage directory. Custom storage
locations are not supported. Folder expansion, selection, keyboard navigation,
toolbars and context menus use the standard Explorer UI. Sketchpad mode shows
only this file container; returning to Solve restores its usual Activity Bar entries.
Opening drawings keeps separate native editor tabs, with the same tab strip as Solve.
Reopening a file selects its existing tab; renaming updates its tab title.
Each tab saves its own file, including while another drawing is active. The atomic `sketchpad/files.json` catalog stores the
folder hierarchy, drawing contents and active file. Existing `draft.json` is
migrated on first use and retained as a backup.

Drawings autosave one second after the last operation; holding the pointer pauses
autosave until release. File/mode switches and hiding the page flush pending edits.
Files are stored under the extension's workspace storage, or its global storage when
no folder is open. The native tab bar offers "Draw beside Code" to open the same
drawing alongside editor groups, and the companion tab can return to Sketchpad mode.
Right-click a drawing in the file tree to clear, import or export it. Clear Drawing
and Import require confirmation before replacing the selected file. Export uses a
native format picker and file dialog for `.excalidraw`, PNG or SVG. The canvas has
no duplicate file toolbar; save failures retain an inline retry action.

Run `npm ci`, `npm test` and `npm run typecheck` in this directory. The repository's
`compile-oi-extensions` command builds the extension and its offline Webview assets.

The native file tree uses Explorer row inputs for creating and renaming files and folders. Drag a drawing or folder into another folder, or into the empty tree area to move it to the root. Storage stays inside the IDE storage directory.
