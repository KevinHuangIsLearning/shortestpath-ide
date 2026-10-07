# Native IDE bridge E2E driver

This opt-in development extension runs inside the real desktop extension host alongside shortestpath.oj and CPH Plus. It provides a token-protected HTTP driver on 127.0.0.1:21475 for the adjacent SPOJ Playwright suite. It is not bundled in product builds and does not replace vscode, OJ, CPH, or the judge.

Use a normal development extension here. `--extensionTestsPath` makes VS Code workspace storage in-memory; tests launched that way cannot verify durable workspaceState after restarting the desktop.

## Preparation

Install the root and bundled extension dependencies, obtain the repository Electron build, run `npm run typecheck-client` and `npm run transpile-client`, and compile both extensions. The CPH build also requires the repository webpack dependencies and a local C++ compiler for sample tests.

```bash
npm test --prefix extensions/shortestpath.oj
npm run vscode:prepublish --prefix extensions/shortestpath.judger
```

Start SPOJ's isolated stack with `E2E_IDE_BRIDGE=true bash scripts/e2e-stack.sh`. That mode seeds the native judge fixtures and starts a local deterministic correction provider, without calling an external AI service. The fixture keeps the correction self-check gate enabled with a one-minute window, and the suite waits for server eligibility before starting a paid task. See SPOJ's `docs/shortestpath-ide-e2e-2026-10-02.md` for the full setup and coverage.

## Launch and run

Use the same token, origin, profile and workspace in the driver and Playwright terminals. Choose a fresh token for each isolated environment. The origin must match the webpage exactly.

```bash
export SHORTESTPATH_IDE_TEST_TOKEN=your-local-test-token
export SHORTESTPATH_OJ_DEV_ORIGIN=http://127.0.0.1:13000
export SHORTESTPATH_IDE_E2E_ROOT=/tmp/shortestpath-ide-e2e
export SHORTESTPATH_IDE_E2E_WORKSPACE=/tmp/shortestpath-ide-e2e/workspace
bash test/ide-bridge/launch.sh
```

Launch creates isolated user data, extension data and source files. It disables workspace trust only in that test profile. Close other IDE development instances using OJ/CPH's ports before launch. From SPOJ's web directory:

```bash
SHORTESTPATH_IDE_E2E=1 PLAYWRIGHT_EXTERNAL_STACK=1 \
PLAYWRIGHT_BASE_URL="$SHORTESTPATH_OJ_DEV_ORIGIN" \
pnpm exec playwright test e2e/shortestpath-ide-bridge.spec.ts
```

If this checkout is not at `~/workspace/shortestpath-ide`, export `SHORTESTPATH_IDE_ROOT` for the restart test. Test endpoints require `Authorization: Bearer $SHORTESTPATH_IDE_TEST_TOKEN`. `/state` reads the bound session; `/submit-file` edits a real document and invokes the production submit command; `/aux-start` calls production recovery; `/local-test` runs real CPH tests. `/request` and `/submit` drive bridge operations. `/stop` saves test documents and quits the isolated desktop, flushing storage to disk. These endpoints are test tools and must not be exposed outside loopback.

The restart test launches a new process with the same profile and workspace. Preserve that profile during the test, then stop the desktop before deleting it. Playwright writes screenshots and desktop restart logs into SPOJ's `web/test-results/`. Stop the isolated stack and Web dev process after testing; the stack's exit handler removes its containers and volumes and stops its provider.
