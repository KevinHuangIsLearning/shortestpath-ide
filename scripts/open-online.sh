#!/usr/bin/env bash
set -euo pipefail

IDE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRACTICE_DIR="${1:-$HOME/workspace/shortestpath-practice}"
PROFILE_DIR="$IDE_ROOT/tmp/shortestpath-online"

cd "$IDE_ROOT"
if [[ ! -f out/vs/code/electron-main/main.js ]]; then
  echo 'Core development build is missing. Run npm run transpile-client first.' >&2
  exit 1
fi
# Plain transpilation lacks indexed messages; use the localized build for this profile.
if [[ ! -s out/vs/base/browser/ui/codicons/codicon/codicon.ttf || ! -s out/nls.keys.json ]]; then
  npm run transpile-client-localized
fi
npm run compile-oi-extensions
mkdir -p "$PRACTICE_DIR" "$PROFILE_DIR/extensions"
# Use the production Origin allowlist and normal persistent workspace storage.
unset SHORTESTPATH_OJ_DEV_ORIGIN SHORTESTPATH_IDE_TEST_TOKEN
export VSCODE_SKIP_PRELAUNCH=1
exec ./scripts/code.sh \
  --user-data-dir="$PROFILE_DIR" \
  --extensions-dir="$PROFILE_DIR/extensions" \
  --extensionDevelopmentPath="$IDE_ROOT/extensions/shortestpath.oj" \
  --extensionDevelopmentPath="$IDE_ROOT/extensions/shortestpath.judger" \
  --enable-proposed-api=shortestpath.judger \
  "$PRACTICE_DIR"
