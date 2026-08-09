# macOS 安装指南

> [English](macos-install.en.md)

## 1. 准备工作

- 一台 Apple Silicon 的 Mac，如果没有，请你在[这里](https://www.apple.com.cn/mac/)更新版本。
- 浏览器下载好 ShortestPath IDE 的 zip 压缩包（一般在「下载 / Downloads」文件夹里）

## 2. 安装步骤

1. **解压**：双击下载的 zip 文件，会自动解压成一个 `ShortestPath IDE.app`。
   
   > 如果双击没反应，去「下载」文件夹，右键 zip → 打开方式 → 归档实用工具。
2. **拖进应用程序**：把 `ShortestPath IDE.app` 拖到「应用程序」文件夹里。
   
   > 拖不进去？说明当前账户没有管理员权限。没关系，拖进你自己的用户目录下的「应用程序」文件夹（`~/Applications`）效果一样。
3. **首次打开**：双击 `ShortestPath IDE.app`。此时很可能被 Mac 拦一下——正常现象，请看下一节。

## 3. 为什么 Mac 会拦我？

**你实际看到的基本是这条提示：**

> 「ShortestPath IDE 已损坏，无法打开。你应该将它移到废纸篓」

**先别慌——文件没有坏，也不是病毒（没人那么闲）。** 这是 macOS 的 **Gatekeeper** 安全机制在拦截「从网上下载、但没有 Apple 官方签名」的软件。macOS 把这类软件统一说成「已损坏」，这只是它的默认说法，不代表你的下载有问题。

（个别系统版本也可能显示「无法验证开发者」或「Apple 无法检查其是否包含恶意软件」，含义相同，都按第 4 节解决。）

ShortestPath IDE 是开源项目，没有购买 Apple 的签名服务，所以会触发这个提示。**这是 macOS 对所有未签名软件的默认检查，不是针对本项目的特殊警告。**

## 4. 解决办法（终端命令，唯一有效）

1. 按 `⌘+空格`，输入 `terminal`，回车，打开「终端」
2. **先把 app 拖进「应用程序」**（如果还没拖），然后粘贴下面这行命令，回车（需要输入开机密码就输入，输的时候屏幕不显示是正常的）：

```bash
xattr -c "/Applications/ShortestPath IDE.app"
```

3. 再打开 `ShortestPath IDE.app` 就能正常启动了。

> **`xattr -c` 是清除文件上所有扩展属性**，一条命令把「从网上下载」的拦截标记全部清掉。它是这类报错的终极解法。
>
> 如果装在了用户目录的应用文件夹，把路径换成 `~/Applications/ShortestPath IDE.app` 即可。
>
> 如果 app 还在「下载」文件夹里没拖走，就直接对下载路径执行（记得先确认路径拼写）。

## 5. 常见问题速查

| 提示 | 原因 | 解决办法 |
| --- | --- | --- |
| 「无法验证开发者」「已损坏，无法打开。你应该将它移到废纸篓」「Apple 无法检查其是否包含恶意软件」 | Gatekeeper 拦截未签名软件 | 终端执行 `xattr -c` 命令 |
| 双击 zip 没反应 | 默认打开方式不对 | 右键 zip → 打开方式 → 归档实用工具 |
| 打开后界面是英文 | 语言包未生效 | 拷打 KevinHuang 叫他修 bug |
| 打开后一片空白 / 卡在加载 | 首次启动较慢 | 等。一直出不来就在 https://www.apple.com.cn/mac/ 更新一下 |

**「已损坏」提示的 90% 情况都靠 `xattr -c` 解决**——如果遇到别的报错，先把提示截图发到 [Issues](https://github.com/KevinHuangIsLearning/shortestpath-ide/issues)，我们帮你看。

## 6. 其他平台

- **Windows**：下载安装包或 zip，解压后运行 `ShortestPath.exe`；若 SmartScreen 提示「已保护你的电脑」，点「更多信息」→「仍要运行」。
- ~~**Linux**：解压后运行 `./code` 或 `./ShortestPath`，可能需要 `chmod +x`。~~ 懒得开发 Linux，自己编译去。

## 7. 为什么项目不直接签名

穷。
