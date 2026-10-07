#!/usr/bin/env bash
set -euo pipefail
umask 077

IDE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$IDE_ROOT"

# Rebuild the localized development client and bundled OI extensions without
# creating a distribution package. Each launch gets a completely empty profile.
if [[ "${1:-}" != "--skip-build" ]]; then
	npm run transpile-client-localized
	npm run compile-oi-extensions
fi

if [[ ! -f out/vs/code/electron-main/main.js || ! -s out/nls.keys.json || ! -f extensions/shortestpath.setup/out/extension.js ]]; then
	echo 'Development output is missing. Run this script without --skip-build.' >&2
	exit 1
fi

RUN_DIR="$(mktemp -d /tmp/shortestpath-first-run.XXXXXX)"
mkdir -p "$RUN_DIR/user-data" "$RUN_DIR/extensions" "$RUN_DIR/shared-data" "$RUN_DIR/workspace"
PORTS="$(node <<'NODE'
const net = require('node:net');
(async () => {
	const servers = Array.from({ length: 4 }, () => net.createServer());
	await Promise.all(servers.map(server => new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	})));
	const ports = servers.map(server => server.address().port);
	await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
	console.log(ports.join(' '));
})().catch(error => { console.error(error); process.exit(1); });
NODE
)"
read -r CDP_PORT EXT_HOST_PORT MAIN_PORT AGENT_HOST_PORT <<< "$PORTS"

# Preserve the ordinary first-run UI, including native dialogs and workspace
# trust. Do not seed settings, initialization markers, or authenticated profiles.
unset ELECTRON_RUN_AS_NODE VSCODE_PORTABLE SP_USE_LEGACY_FIRST_RUN
export VSCODE_SKIP_PRELAUNCH=1
IDE_PID="$(node - "$RUN_DIR" "$CDP_PORT" "$EXT_HOST_PORT" "$MAIN_PORT" "$AGENT_HOST_PORT" <<'NODE'
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const [runDir, cdp, extensions, main, agent] = process.argv.slice(2);
const log = fs.openSync(`${runDir}/code.log`, 'a');
const child = spawn('./scripts/code.sh', [
	'--locale=zh-cn',
	`--user-data-dir=${runDir}/user-data`,
	`--extensions-dir=${runDir}/extensions`,
	`--shared-data-dir=${runDir}/shared-data`,
	`--remote-debugging-port=${cdp}`,
	`--inspect-extensions=${extensions}`,
	`--inspect=${main}`,
	`--inspect-agenthost=${agent}`,
	'--new-window',
], { detached: true, stdio: ['ignore', log, log] });
child.once('error', error => { console.error(error); process.exitCode = 1; });
child.once('spawn', () => { console.log(child.pid); child.unref(); fs.closeSync(log); });
NODE
)"

echo "First-run profile: $RUN_DIR"
echo "Suggested test workspace: $RUN_DIR/workspace"
echo "Startup log: $RUN_DIR/code.log"
echo "PID: $IDE_PID; CDP port: $CDP_PORT"

for (( attempt=0; attempt<90; attempt++ )); do
	if curl --silent --fail "http://127.0.0.1:$CDP_PORT/json/version" > /dev/null; then
		echo 'ShortestPath IDE is ready.'
		exit 0
	fi
	if ! kill -0 "$IDE_PID" 2>/dev/null; then
		cat "$RUN_DIR/code.log" >&2
		exit 1
	fi
	sleep 1
done
tail -n 60 "$RUN_DIR/code.log" >&2
echo 'Timed out waiting for ShortestPath IDE.' >&2
exit 1
