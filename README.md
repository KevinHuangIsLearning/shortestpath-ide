# ShortestPath IDE

ShortestPath IDE is a competitive-programming-focused distribution of Code - OSS.
It provides a streamlined C++ workflow, Competitive Programming Helper defaults,
online-judge mappings, and a guided first-run toolchain setup for macOS, Windows,
and Linux.

## Highlights

- Guided Recommended first-run setup with a dedicated workspace step
- Platform-specific compiler setup with bundled clangd on Windows
- Selectable GitHub Release and GH mirror downloads on Windows and Linux
- C++ compiler, clangd, CPH, VJudge, editor font, ligature, and save defaults
- Built-in Simplified Chinese localization for the bundled OI extensions

## Build from source

```bash
git clone https://github.com/KevinHuangIsLearning/shortestpath-ide.git
cd shortestpath-ide
npm ci
npm run compile
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

## Toolchains used by setup

| Platform | C++ compiler | Language server |
| --- | --- | --- |
| Windows | [WinLibs GCC 16.1.0](https://github.com/brechtsanders/winlibs_mingw/releases/download/16.1.0posix-14.0.0-ucrt-r3/winlibs-x86_64-posix-seh-gcc-16.1.0-mingw-w64ucrt-14.0.0-r3.zip), downloaded from the user-selected GitHub Release or GH mirror | Bundled [clangd 22.1.6](https://github.com/clangd/clangd/releases/tag/22.1.6) Portable |
| macOS (Apple Silicon) | GCC installed through Homebrew | LLVM clangd installed through Homebrew |
| Linux | System g++ (install it with the distribution package manager if missing) | [clangd 22.1.6](https://github.com/clangd/clangd/releases/tag/22.1.6) Portable, downloaded from the user-selected GitHub Release or GH mirror |

The bundled Windows clangd archive is an unmodified upstream Portable release.
It is extracted into ShortestPath IDE's user-data directory on first run, so
Windows users do not need external network access to obtain clangd. Linux stores
its downloaded Portable clangd in the same per-user toolchain directory. macOS
installs GCC and LLVM through Homebrew.

## License

ShortestPath IDE is licensed under [GPL-3.0-or-later](LICENSE). The original
Code - OSS [MIT license text](licenses/MIT-VSCode.txt) and Microsoft copyright
notice are preserved as required for the upstream code. Bundled extensions and
dependencies remain available under their respective licenses.
