# ShortestPath IDE

ShortestPath IDE is a competitive-programming-focused distribution of Code - OSS.
It provides a streamlined C++ workflow, Competitive Programming Helper defaults,
online-judge mappings, and a guided first-run toolchain setup for macOS, Windows,
and Linux.

## Highlights

- First-run setup with Recommended and Custom modes
- Platform-specific compiler setup with bundled clangd on macOS and Windows
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

## Toolchains used by setup

| Platform | C++ compiler | Language server |
| --- | --- | --- |
| Windows | Isolated MSYS2 MinGW GCC, downloaded from the TUNA mirror | Bundled [clangd 22.1.6](https://github.com/clangd/clangd/releases/tag/22.1.6) Portable |
| macOS (Apple Silicon) | GCC installed through Homebrew | Bundled [clangd 22.1.6](https://github.com/clangd/clangd/releases/tag/22.1.6) Portable |
| Linux | Isolated Portable GCC and clangd environment | Downloaded during first-run setup |

The bundled clangd archives are unmodified upstream Portable releases. They are
extracted into ShortestPath IDE's user-data directory on first run, so macOS and
Windows users do not need external network access to obtain clangd.

## License

ShortestPath IDE is licensed under [GPL-3.0-or-later](LICENSE). The original
Code - OSS [MIT license text](licenses/MIT-VSCode.txt) and Microsoft copyright
notice are preserved as required for the upstream code. Bundled extensions and
dependencies remain available under their respective licenses.
