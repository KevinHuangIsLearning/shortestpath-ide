# ShortestPath IDE

ShortestPath IDE is a competitive-programming-focused distribution of Code - OSS.
It provides a streamlined C++ workflow, Competitive Programming Helper defaults,
online-judge mappings, and a guided first-run toolchain setup for macOS, Windows,
and Linux.

## Highlights

- First-run setup with Recommended and Custom modes
- Platform-specific compiler setup: Homebrew on macOS and isolated Portable
  toolchains on Windows and Linux
- Configurable package download sources, including TUNA
- C++ compiler, clangd, CPH, VJudge, editor font, ligature, and save defaults
- Built-in Simplified Chinese localization for the bundled OI extensions

## Build from source

```bash
git clone https://github.com/KevinHuangIsLearning/shortestpath-ide.git
cd shortestpath-ide
npm install
cd vscode
npm install
npm run compile-client
./scripts/code.sh --locale zh-cn
```

To build a macOS Apple Silicon package:

```bash
cd vscode
npm run gulp vscode-darwin-arm64-min
```

## First-run setup

On first launch, ShortestPath IDE opens a dedicated setup window before the
workbench. To run it again, use the command palette command:

`ShortestPath IDE: Re-run First-Run Setup`.

## License

ShortestPath IDE is licensed under [GPL-3.0-or-later](LICENSE). The original
Code - OSS [MIT license text](licenses/MIT-VSCode.txt) and Microsoft copyright
notice are preserved as required for the upstream code. Bundled extensions and
dependencies remain available under their respective licenses.
