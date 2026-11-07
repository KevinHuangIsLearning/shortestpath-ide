# Remote configurations

For local Home development, fully quit the source IDE and start it from the repository root with `SHORTESTPATH_HOMEPAGE_DEBUG=1 ./scripts/code.sh`. Open Home, edit `remote_configurations/homepage/index.html`, then leave and re-enter Home to load the changes. Each navigation reads the source HTML directly, with the real IDE data, theme and command bridge. No compilation is required for HTML edits. This explicit override is accepted only by source builds (`isBuilt === false`); packaged builds still require the remote flag. Debugging skips remote flag/page downloads and uses a separate `homepage-debug` cache directory. Remove the environment variable and restart to test normal remote behavior.

- `configurations/features.json`: remotely controlled feature flags. Set `homepage` to the boolean `true` to enable Home; all other values disable it.
- `homepage/index.html`: complete homepage with inline styles, scripts, countdowns and copy. Setup compilation copies it into the extension as the offline default.

Publish these paths on the `main` branch of the main repository and its GitCode mirror. IDE clients request GitHub first and fall back to GitCode on failure. Flags are checked at Setup activation and every 12 hours. Homepage HTML is checked when its local server starts and every 12 hours while enabled. Downloaded HTML is activated on the next entry to Home; the previous cached version is then removed.
