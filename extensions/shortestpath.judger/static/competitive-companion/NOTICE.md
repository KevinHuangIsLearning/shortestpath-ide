# Competitive Companion parser bundle

Upstream: https://github.com/jmerle/competitive-companion
Version: 2.65.0
Pinned commit: df90fabb52e8f566ea3382405e22d246af5d6a69
Copyright: Jasper van Merle. MIT license, included in LICENSE.

The parser registry is reused unchanged. ShortestPath's adapter selects the matching parser, returns Task/Contest data through CDP rather than extension runtime messaging, and supplies parser defaults and a background-GET shim. It does not install a Chrome extension or add upstream telemetry. The bundle includes all upstream parsers; online parsing depends on each site's current DOM, access permissions, CORS, and PDF/blob policy. Native browser-extension privileged cross-origin background requests are not equivalent to the page fetch shim. Failures are surfaced; no problem is invented.

Dependencies used in the bundle have license texts in THIRD-PARTY-LICENSES.txt. Source and dependency integrity are pinned; build inputs are scripts/companion/package.json and package-lock.json.

Rebuild from repository root:

1. Clone upstream and checkout the pinned commit above.
2. In `extensions/shortestpath.judger/scripts/companion`, run `npm ci --ignore-scripts --no-audit --no-fund`.
3. Run `node extensions/shortestpath.judger/scripts/build-companion.ts /absolute/upstream/path extensions/shortestpath.judger/scripts/companion`.

The script verifies the upstream commit. The `parsers.bundle.txt` asset is executable JavaScript packaged as text and read by the extension; this keeps vendored code outside application TS and JS lint/compile pipelines. Upstream PDF/ZIP build substitutions are preserved.

Validation on 2026-10-04: live CSES task 1068 parsed in a real Chromium CDP isolated world; unsupported example.com fails explicitly. No claim of online validation across all upstream sites or authenticated contests.

2026-10-06 adapter update: parser inspection returns stable class identifiers, display names, match patterns and page-match results; manual parsing may specify an identifier from this registry. The build preserves class names and emits `parsers.runtime.txt` for inspection in addition to the parse expression bundle. The upstream parser registry and pinned commit remain unchanged. Production control verification is reproducible with `node extensions/shortestpath.judger/scripts/test-browser-import.ts` after building Judger. It covers strict CSP, search, manual selection, dragging and live CSES task 1068 in Chromium; it is not full IDE or all-site validation.
