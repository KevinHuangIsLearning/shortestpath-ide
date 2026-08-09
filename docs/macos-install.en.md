# macOS Installation Guide

> [简体中文](macos-install.md)

## 1. Preparation

- An Apple Silicon Mac; if you don't have one, please upgrade your device [here](https://www.apple.com.cn/mac/).
- Download the ShortestPath IDE zip archive via your browser (usually found in the "Downloads" folder).

## 2. Installation Steps

1. **Unzip**: Double-click the downloaded zip file; it will automatically extract into `ShortestPath IDE.app`.

> If double-clicking doesn't work, go to the "Downloads" folder, right-click the zip file → Open With → Archive Utility.

2. **Move to Applications**: Drag `ShortestPath IDE.app` into the "Applications" folder. 

> Can't drag it in? This means your current account lacks administrator privileges. No problem—dragging it into the "Applications" folder within your user directory (`~/Applications`) works just as well.

3. **First Launch**: Double-click `ShortestPath IDE.app`. You will likely encounter a warning from macOS—this is normal; please see the next section.

## 3. Why is macOS blocking me?

**You will likely see a prompt like this:**

> "ShortestPath IDE is damaged and can't be opened. You should move it to the Trash."

**Don't panic—the file isn't actually damaged, nor is it a virus.** This is the macOS **Gatekeeper** security mechanism blocking software that was downloaded from the internet but lacks an official Apple signature. macOS labels such software as "damaged" by default; this does not mean there is anything wrong with your download.

(Some system versions might display "Cannot verify developer" or "Apple cannot check it for malicious software" instead; the meaning is the same, and the solution in Section 4 applies to all these cases.)

ShortestPath IDE is an open-source project and does not use Apple's paid signing service, which triggers this prompt. **This is a standard macOS check for all unsigned software, not a warning specific to this project.** **

## 4. Solution (Terminal command—the only effective method)

1. Press `⌘ + Space`, type `terminal`, and press Enter to open the Terminal.
2. **First, drag the app into the "Applications" folder** (if you haven't already), then paste the command below and press Enter (enter your system login password if prompted; it is normal for the screen not to show characters while typing):

```bash
xattr -c "/Applications/ShortestPath IDE.app"
```

3. Now, open `ShortestPath IDE.app`, and it should launch normally.

> **`xattr -c` clears all extended attributes from the file**; this single command removes the "downloaded from the internet" quarantine flag. It is the ultimate solution for this type of error.
>
> If you installed it in the user-specific Applications folder, simply change the path to `~/Applications/ShortestPath IDE.app`.
>
> If the app is still in the "Downloads" folder and hasn't been moved, run the command directly on that path (make sure to verify the path spelling first).

## 5. Quick FAQ

| Alert Message                                                | Cause                                 | Solution                                                     |
| ------------------------------------------------------------ | ------------------------------------- | ------------------------------------------------------------ |
| "Cannot verify developer" / "Damaged and can't be opened" / "Apple cannot check for malicious software" | Gatekeeper blocking unsigned software | Run the `xattr -c` command in Terminal                       |
| Double-clicking the zip file does nothing                    | Incorrect default opener              | Right-click zip → Open With → Archive Utility                |
| Interface is in English after opening                        | Language pack not active              | Pester KevinHuang to fix the bug                             |
| Blank screen / Stuck on loading after opening                | Slow initial startup                  | Wait. If it still won't launch, try updating via https://www.apple.com.cn/mac/ |

**90% of "Damaged" errors can be resolved using `xattr -c`**—if you encounter other error messages, please take a screenshot and post it to [Issues](https://github.com/KevinHuangIsLearning/shortestpath-ide/issues) so we can take a look.

---

## 6. Other Platforms

- **Windows**: Download the installer or zip file, extract it, and run `ShortestPath.exe`; if SmartScreen displays a "Windows protected your PC" warning, click "More info" → "Run anyway".
- ~~**Linux**: Extract and run `./code` or `./ShortestPath`; you may need to run `chmod +x` first.~~ Too lazy to develop for Linux; compile it yourself.

---

## 7. Why isn't the project signed?

We're broke.
