#!/usr/bin/env bash
set -euo pipefail
IDE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
: "${SHORTESTPATH_IDE_TEST_TOKEN:?Set a unique token for the local E2E host}"
: "${SHORTESTPATH_OJ_DEV_ORIGIN:?Set the exact isolated website loopback origin}"
export SHORTESTPATH_IDE_E2E_ROOT="${SHORTESTPATH_IDE_E2E_ROOT:-/tmp/shortestpath-ide-e2e}"
export SHORTESTPATH_IDE_E2E_WORKSPACE="${SHORTESTPATH_IDE_E2E_WORKSPACE:-$SHORTESTPATH_IDE_E2E_ROOT/workspace}"
export SHORTESTPATH_IDE_TEST_READY="$SHORTESTPATH_IDE_E2E_ROOT/ready"
mkdir -p "$SHORTESTPATH_IDE_E2E_WORKSPACE" "$SHORTESTPATH_IDE_E2E_ROOT/fork-user/User" "$SHORTESTPATH_IDE_E2E_ROOT/extensions"
node - <<'JS'
const fs = require('node:fs');
const p = process.env.SHORTESTPATH_IDE_E2E_ROOT + '/fork-user/User/settings.json';
const settings = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : {};
Object.assign(settings, { 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'telemetry.telemetryLevel': 'off', 'cph.general.defaultLanguage': 'cpp', 'cph.general.saveLocation': process.env.SHORTESTPATH_IDE_E2E_WORKSPACE, 'shortestpath.oj.cppSubmissionLanguage': 'cpp20', 'update.mode': 'none' });
fs.writeFileSync(p, JSON.stringify(settings, null, 2));
JS
cd "$IDE_ROOT"
export VSCODE_SKIP_PRELAUNCH=1
exec ./scripts/code.sh --user-data-dir="$SHORTESTPATH_IDE_E2E_ROOT/fork-user" --extensions-dir="$SHORTESTPATH_IDE_E2E_ROOT/extensions" --extensionDevelopmentPath="$IDE_ROOT/extensions/shortestpath.oj" --extensionDevelopmentPath="$IDE_ROOT/extensions/divyanshuagrawal.competitive-programming-helper" --extensionDevelopmentPath="$IDE_ROOT/test/ide-bridge" --disable-workspace-trust --enable-proposed-api=DivyanshuAgrawal.competitive-programming-helper "$SHORTESTPATH_IDE_E2E_WORKSPACE"
