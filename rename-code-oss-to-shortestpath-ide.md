# 改名：Code - OSS → ShortestPath IDE

定制版 VSCode（`/Users/kevin/Documents/VSCode-for-OI/vscode`，基于 Code - OSS）全套品牌替换为 ShortestPath IDE。

## 决策

- `nameShort` = `ShortestPath`
- `nameLong` = `ShortestPath IDE`
- `applicationName` = `shortestpath`
- `dataFolderName` = `.shortestpath-ide`
- `darwinBundleIdentifier` = `com.shortestpath.ide`
- `urlProtocol` = `shortestpath`

UI 上所有产品名（macOS 菜单栏粗体名、About/Hide/Quit 菜单项、窗口标题、欢迎页产品名、设置同步提示、遥测提示）都引用 `productService.nameShort` / `nameLong`，改 `product.json` 即自动跟随，**无需改源码**。已确认位置：

- `src/vs/platform/menubar/electron-main/menubar.ts:285,409,421,425`（菜单栏粗体名=nameShort，About/Hide/Quit=nameLong）
- `src/vs/platform/windows/electron-main/windows.ts:146`、`windowImpl.ts:1185`、`src/vs/workbench/browser/parts/titlebar/windowTitle.ts:361`（窗口标题=nameLong）
- `src/vs/workbench/contrib/welcomeGettingStarted/browser/gettingStarted.ts:927,1662`（欢迎页产品名=nameLong，遥测提示=nameShort）
- `src/vs/workbench/contrib/userDataSync/browser/userDataSync.contribution.ts:38-39`、`userDataSync.ts:359`（设置同步提示=nameLong）

## 执行顺序

### 1. 改 `product.json`（核心，杠杆点）

逐字段替换：

| 字段 | 当前 | 新值 |
|---|---|---|
| nameShort | `Code - OSS` | `ShortestPath` |
| nameLong | `Code - OSS` | `ShortestPath IDE` |
| applicationName | `code-oss` | `shortestpath` |
| dataFolderName | `.vscode-oss` | `.shortestpath-ide` |
| sharedDataFolderName | `.vscode-oss-shared` | `.shortestpath-ide-shared` |
| win32MutexName | `vscodeoss` | `shortestpath` |
| win32DirName | `Microsoft Code OSS` | `ShortestPath IDE` |
| win32NameVersion | `Microsoft Code OSS` | `ShortestPath IDE` |
| win32RegValueName | `CodeOSS` | `ShortestPathIDE` |
| win32AppUserModelId | `Microsoft.CodeOSS` | `com.shortestpath.ide` |
| win32ShellNameShort | `C&ode - OSS` | `S&hortestPath` |
| win32TunnelServiceMutex | `vscodeoss-tunnelservice` | `shortestpath-tunnelservice` |
| win32TunnelMutex | `vscodeoss-tunnel` | `shortestpath-tunnel` |
| darwinBundleIdentifier | `com.visualstudio.code.oss` | `com.shortestpath.ide` |
| linuxIconName | `code-oss` | `shortestpath` |
| serverApplicationName | `code-server-oss` | `shortestpath-server` |
| serverDataFolderName | `.vscode-server-oss` | `.shortestpath-server` |
| tunnelApplicationName | `code-tunnel-oss` | `shortestpath-tunnel` |
| urlProtocol | `code-oss` | `shortestpath` |

`win32x64AppId` / `win32arm64AppId` / `win32x64UserAppId` / `win32arm64UserAppId` 这 4 个 GUID **保留不动**——重新生成易和已安装版本冲突，且不影响显示名。

### 2. 改根 `package.json`

- `"name": "code-oss-dev"` → `"shortestpath-ide-dev"`

### 3. 改 `resources/` 下硬编码产品名（打包模板）

这些文件里直接写了产品名字符串，需手动改（把 `Code - OSS` / `code-oss` / `Visual Studio Code` 替换为对应新值）：

- `resources/linux/code.desktop`
- `resources/linux/code-url-handler.desktop`
- `resources/linux/code.appdata.xml`
- `resources/linux/debian/control.template`
- `resources/linux/debian/templates.template`
- `resources/linux/debian/postinst.template`
- `resources/linux/snap/snapcraft.yaml`
- `resources/linux/rpm/code.spec.template`
- `resources/server/manifest.json`
- `resources/win32/VisualElementsManifest.xml`

macOS 应用名 / Bundle 名由 `product.json` 的 `nameLong` / `darwinBundleIdentifier` 在构建时注入，无模板需手改。

### 4. 构建脚本

`build/gulpfile.vscode.ts` 用 `replace('@@APPNAME@@', product.applicationName)` 动态生成 desktop 文件名、`bin/` 可执行文件名、rpm/deb 包名，**自动传导，不硬改**。

`build/azure-pipelines/*.yml` 里硬编码的 `code-oss` 是 CI 流水线配置，本地编译运行不依赖，**本次不动**。

### 5. 编译

```bash
npm run compile
```

源码层改动必须重新编译到 `out/` 才生效。`product.json` 在运行时读取，但保险起见也走一次编译。

### 6. 数据迁移（必做，否则配置"丢失"）

改 `nameLong` 后，macOS 配置目录从 `~/Library/Application Support/Code - OSS/` 变成 `~/Library/Application Support/ShortestPath IDE/`（路径名来自 `nameLong`）。`dataFolderName` 改了之后扩展目录前缀也从 `.vscode-oss` 变 `.shortestpath-ide`。手动迁移：

```bash
mv ~/Library/Application\ Support/Code\ -\ OSS ~/Library/Application\ Support/ShortestPath\ IDE
mv ~/.vscode-oss ~/.shortestpath-ide   # 若该目录有内容；扩展本就内置在仓库 extensions/，这里可能为空
```

扩展全内置在仓库 `extensions/` 目录，不依赖 `~/.shortestpath-ide/extensions/`，不受影响。

## 验证

- 启动后 macOS 菜单栏粗体名显示 `ShortestPath`
- `About` 菜单项和 About 对话框显示 `ShortestPath IDE`
- 窗口标题、欢迎页产品名显示新名
- 终端 `shortestpath --version` 能跑（CLI 命令名跟随 `applicationName`）
- `~/Library/Application Support/ShortestPath IDE/` 下能看到迁移过来的 settings.json 等

## 注意

- 这是 Code - OSS 变体，不是标准 VS Code。改行为一律在源码层（`src/` 或 `extensions/`），别碰 `~/Library/Application Support/Code` 或 `~/.vscode/extensions`——那是标准 Code 的，定制版不用。
- 改 `nameLong` 导致 macOS 配置目录路径变化，迁移步骤不能省。
- `win32` 相关字段对 macOS/Linux 运行无影响，但为打包完整性一并改掉。
