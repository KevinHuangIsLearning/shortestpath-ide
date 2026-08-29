# Repository Guidelines

## Project Structure & Module Organization

ShortestPath IDE is a Code - OSS fork for OI/ICPC workflows. Core TypeScript lives in `src/vs/`: utilities in `base/`, services in `platform/`, editor code in `editor/`, and desktop UI in `workbench/`. Bundled extensions live in `extensions/`. Build tooling is under `build/` and `scripts/`; tests are colocated in `src/vs/**/test/` or grouped under `test/`. Assets belong in `resources/`. Do not edit generated `out/` or `.build/` files.

## Build, Test, and Development Commands

Run commands from the repository root:

- `npm ci` installs pinned dependencies.
- `npm run typecheck-client` checks core TypeScript.
- `npm run compile-oi-extensions` builds bundled OI extensions.
- `./scripts/code.sh --locale zh-cn --user-data-dir ./tmp/shortestpath-dev` launches an isolated development instance.
- `npm run test-node -- --run <test-file>` runs a focused Node test.
- `./scripts/test.sh --glob '**/feature*.test.js'` runs focused Electron tests.
- `npm run test-browser-no-install` runs browser tests.
- `npm run gulp vscode-darwin-arm64-min` or `npm run gulp vscode-win32-x64-min` creates platform packages.

Before tests, follow `.github/copilot-instructions.md`: use the build watch task when available, otherwise the typecheck or extension gulp task. Do not use `npm run compile` for TypeScript validation.

## Coding Style & Naming Conventions

Use tabs, single quotes for non-localized strings, braces for control flow, and `async`/`await`. Use PascalCase for types and enum values; camelCase for functions and variables. Localize visible text through `vs/nls`, preserve copyright headers, and register disposables immediately. Run `npm run eslint`, `npm run stylelint`, and `npm run valid-layers-check` where relevant.

## Testing Guidelines

Place tests beside the owning component as `*.test.ts`; integration cases use `*.integrationTest.ts`. Follow existing `suite`/`test` patterns and prefer a clear `assert.deepStrictEqual`. Add regression coverage for fixes; run coverage with `./scripts/test.sh --coverage`.

## Agent Workflow for Difficult Tasks

For difficult tasks, create a plan before development. After implementation, start an independent review agent/thread that must not modify code. It should validate requirement completeness, logical correctness, edge cases, code quality, test coverage, and actual runtime results, then return a concrete fix list to the primary agent. The primary agent must address the findings and ask the same reviewer to verify again. Repeat until validation passes or the remaining blocker is clearly documented.

## Clarification Before Assumptions

Do not guess when requirements or externally controlled behavior are unclear. Ask the user before implementing assumptions about website DOM, browser flows, account/session behavior, submission or result formats, expected UI behavior, or any other detail that cannot be verified from the repository or supplied evidence. Clearly state the missing information and wait for the user's direction when it materially affects the implementation.

## ShortestPath Localization

A complete localization change must audit every rendered and dynamic IDE-owned surface, not only `package.nls*.json` or a string dictionary. Check Webview text created at startup and after messages, native dialogs and notifications, command and menu labels, errors, accessibility attributes, titles, placeholders, update UI, diagnostics, and first-run onboarding. Use `localize` or `localizeFormat` at native UI boundaries and cover parameterized or mutation-generated Webview text explicitly.

Preserve externally supplied problem titles, statements, editorials, metadata, algorithm tags, samples, source code, and accepted bilingual examples. Mark external Webview content with `data-i18n-ignore` where necessary instead of translating or rewriting it.

Webview localization bootstraps must satisfy the page CSP, using a nonce when inline scripts are not already allowed. A `MutationObserver` visitor must be idempotent: compare text and attribute values before writing them so the observer cannot trigger itself indefinitely. Add regression coverage for CSP compatibility, unchanged-value guards, dynamic strings, native UI call sites, and external-content boundaries. Validate OJ and Setup extension suites, `npm run typecheck-client`, and `git diff --check` after localization work.

## Commit & Pull Request Guidelines

Use concise Conventional Commit-style subjects, for example `fix(build): match root Windows locale paths`. Keep commits scoped. Pull requests should explain behavior and validation, link issues, and include screenshots for UI changes. Call out packaging impact and bundled-extension or license changes.
