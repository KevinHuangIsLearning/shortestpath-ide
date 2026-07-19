#define RootLicenseFileName FileExists(RepoDir + '\LICENSE.rtf') ? 'LICENSE.rtf' : 'LICENSE'
#define LocalizedLanguageFile(Language = "") \
    Language != "" && FileExists(RepoDir + '\licenses\LICENSE-' + Language + '.rtf') \
      ? ('; LicenseFile: "' + RepoDir + '\licenses\LICENSE-' + Language + '.rtf"') \
      : '; LicenseFile: "' + RepoDir + '\' + RootLicenseFileName + '"'

[Setup]
AppId={#AppId}
AppName={#NameLong}
AppVerName={#NameVersion}
AppPublisher=Microsoft Corporation
AppPublisherURL=https://code.visualstudio.com/
AppSupportURL=https://code.visualstudio.com/
AppUpdatesURL=https://code.visualstudio.com/
DefaultGroupName={#NameLong}
AllowNoIcons=yes
OutputDir={#OutputDir}
OutputBaseFilename=VSCodeSetup
Compression=lzma
SolidCompression=yes
AppMutex={code:GetAppMutex}
SetupMutex={code:GetSetupMutex}
WizardImageFile="{#RepoDir}\resources\win32\inno-big-100.bmp,{#RepoDir}\resources\win32\inno-big-125.bmp,{#RepoDir}\resources\win32\inno-big-150.bmp,{#RepoDir}\resources\win32\inno-big-175.bmp,{#RepoDir}\resources\win32\inno-big-200.bmp,{#RepoDir}\resources\win32\inno-big-225.bmp,{#RepoDir}\resources\win32\inno-big-250.bmp"
WizardSmallImageFile="{#RepoDir}\resources\win32\inno-small-100.bmp,{#RepoDir}\resources\win32\inno-small-125.bmp,{#RepoDir}\resources\win32\inno-small-150.bmp,{#RepoDir}\resources\win32\inno-small-175.bmp,{#RepoDir}\resources\win32\inno-small-200.bmp,{#RepoDir}\resources\win32\inno-small-225.bmp,{#RepoDir}\resources\win32\inno-small-250.bmp"
SetupIconFile={#RepoDir}\resources\win32\code.ico
UninstallDisplayIcon={app}\{#ExeBasename}.exe
ChangesEnvironment=true
ChangesAssociations=true
MinVersion=10.0
SourceDir={#SourceDir}
AppVersion={#Version}
VersionInfoVersion={#RawVersion}
ShowLanguageDialog=auto
ArchitecturesAllowed={#ArchitecturesAllowed}
ArchitecturesInstallIn64BitMode={#ArchitecturesInstallIn64BitMode}
WizardStyle=modern

// We've seen an uptick on broken installations from updates which were unable
// to shutdown VS Code. We rely on the fact that the update signals
// that VS Code is ready to be shutdown, so we're good to use `force` here.
CloseApplications=force

#ifdef Sign
SignTool=esrp
#endif

#if "user" == InstallTarget
DefaultDirName={userpf}\{#DirName}
PrivilegesRequired=lowest
#else
DefaultDirName={pf}\{#DirName}
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl,{#RepoDir}\build\win32\i18n\messages.en.isl" {#LocalizedLanguageFile}
Name: "german"; MessagesFile: "compiler:Languages\German.isl,{#RepoDir}\build\win32\i18n\messages.de.isl" {#LocalizedLanguageFile("deu")}
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl,{#RepoDir}\build\win32\i18n\messages.es.isl" {#LocalizedLanguageFile("esp")}
Name: "french"; MessagesFile: "compiler:Languages\French.isl,{#RepoDir}\build\win32\i18n\messages.fr.isl" {#LocalizedLanguageFile("fra")}
Name: "italian"; MessagesFile: "compiler:Languages\Italian.isl,{#RepoDir}\build\win32\i18n\messages.it.isl" {#LocalizedLanguageFile("ita")}
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl,{#RepoDir}\build\win32\i18n\messages.ja.isl" {#LocalizedLanguageFile("jpn")}
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl,{#RepoDir}\build\win32\i18n\messages.ru.isl" {#LocalizedLanguageFile("rus")}
Name: "korean"; MessagesFile: "{#RepoDir}\build\win32\i18n\Default.ko.isl,{#RepoDir}\build\win32\i18n\messages.ko.isl" {#LocalizedLanguageFile("kor")}
Name: "simplifiedChinese"; MessagesFile: "{#RepoDir}\build\win32\i18n\Default.zh-cn.isl,{#RepoDir}\build\win32\i18n\messages.zh-cn.isl" {#LocalizedLanguageFile("chs")}
Name: "traditionalChinese"; MessagesFile: "{#RepoDir}\build\win32\i18n\Default.zh-tw.isl,{#RepoDir}\build\win32\i18n\messages.zh-tw.isl" {#LocalizedLanguageFile("cht")}
Name: "brazilianPortuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl,{#RepoDir}\build\win32\i18n\messages.pt-br.isl" {#LocalizedLanguageFile("ptb")}
Name: "hungarian"; MessagesFile: "{#RepoDir}\build\win32\i18n\Default.hu.isl,{#RepoDir}\build\win32\i18n\messages.hu.isl" {#LocalizedLanguageFile("hun")}
Name: "turkish"; MessagesFile: "compiler:Languages\Turkish.isl,{#RepoDir}\build\win32\i18n\messages.tr.isl" {#LocalizedLanguageFile("trk")}

[InstallDelete]
Type: filesandordirs; Name: "{app}\{#VersionedResourcesFolder}\resources\app\out"; Check: IsNotBackgroundUpdate
Type: filesandordirs; Name: "{app}\{#VersionedResourcesFolder}\resources\app\plugins"; Check: IsNotBackgroundUpdate
Type: filesandordirs; Name: "{app}\{#VersionedResourcesFolder}\resources\app\extensions"; Check: IsNotBackgroundUpdate
Type: filesandordirs; Name: "{app}\{#VersionedResourcesFolder}\resources\app\node_modules"; Check: IsNotBackgroundUpdate
Type: filesandordirs; Name: "{app}\{#VersionedResourcesFolder}\resources\app\node_modules.asar.unpacked"; Check: IsNotBackgroundUpdate
Type: files; Name: "{app}\{#VersionedResourcesFolder}\resources\app\node_modules.asar"; Check: IsNotBackgroundUpdate
Type: files; Name: "{app}\{#VersionedResourcesFolder}\resources\app\Credits_45.0.2454.85.html"; Check: IsNotBackgroundUpdate

[UninstallDelete]
Type: filesandordirs; Name: "{app}\_"
Type: filesandordirs; Name: "{app}\bin"
Type: files; Name: "{app}\old_*"
Type: files; Name: "{app}\new_*"
Type: files; Name: "{app}\updating_version"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "quicklaunchicon"; Description: "{cm:CreateQuickLaunchIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked; OnlyBelowVersion: 0,6.1
Name: "addcontextmenufiles"; Description: "{cm:AddContextMenuFiles,{#NameShort}}"; GroupDescription: "{cm:Other}"; Flags: unchecked
Name: "addcontextmenufolders"; Description: "{cm:AddContextMenuFolders,{#NameShort}}"; GroupDescription: "{cm:Other}"; Flags: unchecked
Name: "associatewithfiles"; Description: "{cm:AssociateWithFiles,{#NameShort}}"; GroupDescription: "{cm:Other}"
Name: "addtopath"; Description: "{cm:AddToPath}"; GroupDescription: "{cm:Other}"
Name: "runcode"; Description: "{cm:RunAfter,{#NameShort}}"; GroupDescription: "{cm:Other}"; Check: WizardSilent

[Dirs]
Name: "{app}"; AfterInstall: DisableAppDirInheritance

[Files]
Source: "*"; Excludes: "\CodeSignSummary*.md,\tools,\tools\*,\policies,\policies\*,\appx,\appx\*,\resources\app\product.json,\{#ExeBasename}.exe,\{#ExeBasename}.VisualElementsManifest.xml,\bin,\bin\*"; DestDir: "{code:GetDestDir}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#ExeBasename}.exe"; DestDir: "{code:GetDestDir}"; DestName: "{code:GetExeBasename}"; Flags: ignoreversion
Source: "{#ExeBasename}.VisualElementsManifest.xml"; DestDir: "{code:GetDestDir}"; DestName: "{code:GetVisualElementsManifest}"; Flags: ignoreversion
Source: "tools\*"; DestDir: "{app}\{#VersionedResourcesFolder}\tools"; Flags: ignoreversion
Source: "policies\*"; DestDir: "{code:GetDestDir}\{#VersionedResourcesFolder}\policies"; Flags: ignoreversion skipifsourcedoesntexist
Source: "bin\{#TunnelApplicationName}.exe"; DestDir: "{code:GetDestDir}\bin"; DestName: "{code:GetBinDirTunnelApplicationFilename}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "bin\{#ApplicationName}.cmd"; DestDir: "{code:GetDestDir}\bin"; DestName: "{code:GetBinDirApplicationCmdFilename}"; Flags: ignoreversion
Source: "bin\{#ApplicationName}"; DestDir: "{code:GetDestDir}\bin"; DestName: "{code:GetBinDirApplicationFilename}"; Flags: ignoreversion
Source: "{#ProductJsonPath}"; DestDir: "{code:GetDestDir}\{#VersionedResourcesFolder}\resources\app"; Flags: ignoreversion
#ifdef AppxPackageName
Source: "appx\{#AppxPackage}"; DestDir: "{code:GetDestDir}\{#VersionedResourcesFolder}\appx"; BeforeInstall: RemoveAppxPackage; Flags: ignoreversion; Check: ShouldUseWindows11ContextMenu
Source: "appx\{#AppxPackageDll}"; DestDir: "{code:GetDestDir}\{#VersionedResourcesFolder}\appx"; AfterInstall: AddAppxPackage; Flags: ignoreversion; Check: ShouldUseWindows11ContextMenu
#endif

[Icons]
Name: "{group}\{#NameLong}"; Filename: "{app}\{#ExeBasename}.exe"; AppUserModelID: "{#AppUserId}"; Check: ShouldUpdateShortcut(ExpandConstant('{group}\{#NameLong}.lnk'))
Name: "{autodesktop}\{#NameLong}"; Filename: "{app}\{#ExeBasename}.exe"; Tasks: desktopicon; AppUserModelID: "{#AppUserId}"; Check: ShouldUpdateShortcut(ExpandConstant('{autodesktop}\{#NameLong}.lnk'))
Name: "{userappdata}\Microsoft\Internet Explorer\Quick Launch\{#NameLong}"; Filename: "{app}\{#ExeBasename}.exe"; Tasks: quicklaunchicon; AppUserModelID: "{#AppUserId}"; Check: ShouldUpdateShortcut(ExpandConstant('{userappdata}\Microsoft\Internet Explorer\Quick Launch\{#NameLong}.lnk'))

[Run]
Filename: "{app}\{#ExeBasename}.exe"; Description: "{cm:LaunchProgram,{#NameLong}}"; Tasks: runcode; Flags: nowait postinstall; Check: ShouldRunAfterUpdate
Filename: "{app}\{#ExeBasename}.exe"; Description: "{cm:LaunchProgram,{#NameLong}}"; Flags: nowait postinstall; Check: WizardNotSilent

[Registry]
#if "user" == InstallTarget
#define SoftwareClassesRootKey "HKCU"
#else
#define SoftwareClassesRootKey "HKLM"
#endif

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.c++\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.c++\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.c++"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.c++"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,C++}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.c++"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.c++\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#VersionedResourcesFolder}\resources\app\resources\win32\cpp.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.c++\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.c\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.c\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.c"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.c"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,C}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.c"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.c\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#VersionedResourcesFolder}\resources\app\resources\win32\c.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.c\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.c\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.cc\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.cc\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.cc"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.cc"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,C++}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.cc"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.cc\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#VersionedResourcesFolder}\resources\app\resources\win32\cpp.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.cc\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.cc\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.code-workspace\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.code-workspace\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.code-workspace"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.code-workspace"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,Code Workspace}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.code-workspace"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.code-workspace\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#VersionedResourcesFolder}\resources\app\resources\win32\code.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.code-workspace\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.code-workspace\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.cpp\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.cpp\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.cpp"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.cpp"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,C++}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.cpp"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.cpp\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#VersionedResourcesFolder}\resources\app\resources\win32\cpp.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.cpp\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.cpp\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.cxx\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.cxx\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.cxx"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.cxx"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,C++}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.cxx"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.cxx\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#VersionedResourcesFolder}\resources\app\resources\win32\cpp.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.cxx\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.cxx\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.h\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.h\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.h"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.h"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,C Header}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.h"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.h\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#VersionedResourcesFolder}\resources\app\resources\win32\c.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.h\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.h\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.h++\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.h++\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.h++"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.h++"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,C++ Header}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.h++"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.h++\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#VersionedResourcesFolder}\resources\app\resources\win32\cpp.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.h++\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.hh\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.hh\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.hh"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.hh"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,C++ Header}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.hh"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.hh\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#VersionedResourcesFolder}\resources\app\resources\win32\cpp.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.hh\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.hh\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.hpp\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.hpp\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.hpp"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.hpp"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,C++ Header}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.hpp"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.hpp\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#VersionedResourcesFolder}\resources\app\resources\win32\cpp.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.hpp\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.hpp\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.hxx\OpenWithProgids"; ValueType: none; ValueName: "{#RegValueName}"; Flags: deletevalue uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\.hxx\OpenWithProgids"; ValueType: string; ValueName: "{#RegValueName}.hxx"; ValueData: ""; Flags: uninsdeletevalue; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.hxx"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,C++ Header}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.hxx"; ValueType: string; ValueName: "AppUserModelID"; ValueData: "{#AppUserId}"; Flags: uninsdeletekey; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.hxx\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#VersionedResourcesFolder}\resources\app\resources\win32\cpp.ico"; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.hxx\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""; Tasks: associatewithfiles
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}.hxx\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: associatewithfiles

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}SourceFile"; ValueType: string; ValueName: ""; ValueData: "{cm:SourceFile,{#NameLong}}"; Flags: uninsdeletekey
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}SourceFile\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#VersionedResourcesFolder}\resources\app\resources\win32\default.ico"
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}SourceFile\shell\open"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"""
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}SourceFile\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\Applications\{#ExeBasename}.exe"; ValueType: none; ValueName: ""; Flags: uninsdeletekey
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\Applications\{#ExeBasename}.exe\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#VersionedResourcesFolder}\resources\app\resources\win32\default.ico"
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\Applications\{#ExeBasename}.exe\shell\open"; ValueType: string; ValueName: "Icon"; ValueData: """{app}\{#ExeBasename}.exe"""
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\Applications\{#ExeBasename}.exe\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""

Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\{#RegValueName}ContextMenu"; ValueType: expandsz; ValueName: "Title"; ValueData: "{cm:OpenWithCodeContextMenu,{#ShellNameShort}}"; Tasks: addcontextmenufiles; Flags: uninsdeletekey; Check: ShouldUseWindows11ContextMenu
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\*\shell\{#RegValueName}"; ValueType: expandsz; ValueName: ""; ValueData: "{cm:OpenWithCodeContextMenu,{#ShellNameShort}}"; Tasks: addcontextmenufiles; Flags: uninsdeletekey; Check: not ShouldUseWindows11ContextMenu
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\*\shell\{#RegValueName}"; ValueType: expandsz; ValueName: "Icon"; ValueData: "{app}\{#ExeBasename}.exe"; Tasks: addcontextmenufiles; Check: not ShouldUseWindows11ContextMenu
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\*\shell\{#RegValueName}\command"; ValueType: expandsz; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%1"""; Tasks: addcontextmenufiles; Check: not ShouldUseWindows11ContextMenu
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\directory\shell\{#RegValueName}"; ValueType: expandsz; ValueName: ""; ValueData: "{cm:OpenWithCodeContextMenu,{#ShellNameShort}}"; Flags: uninsdeletekey; Check: ShouldInstallLegacyFolderContextMenu
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\directory\shell\{#RegValueName}"; ValueType: expandsz; ValueName: "Icon"; ValueData: "{app}\{#ExeBasename}.exe"; Check: ShouldInstallLegacyFolderContextMenu
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\directory\shell\{#RegValueName}\command"; ValueType: expandsz; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%V"""; Check: ShouldInstallLegacyFolderContextMenu
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\directory\background\shell\{#RegValueName}"; ValueType: expandsz; ValueName: ""; ValueData: "{cm:OpenWithCodeContextMenu,{#ShellNameShort}}"; Flags: uninsdeletekey; Check: ShouldInstallLegacyFolderContextMenu
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\directory\background\shell\{#RegValueName}"; ValueType: expandsz; ValueName: "Icon"; ValueData: "{app}\{#ExeBasename}.exe"; Check: ShouldInstallLegacyFolderContextMenu
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\directory\background\shell\{#RegValueName}\command"; ValueType: expandsz; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%V"""; Check: ShouldInstallLegacyFolderContextMenu
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\Drive\shell\{#RegValueName}"; ValueType: expandsz; ValueName: ""; ValueData: "{cm:OpenWithCodeContextMenu,{#ShellNameShort}}"; Flags: uninsdeletekey; Check: ShouldInstallLegacyFolderContextMenu
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\Drive\shell\{#RegValueName}"; ValueType: expandsz; ValueName: "Icon"; ValueData: "{app}\{#ExeBasename}.exe"; Check: ShouldInstallLegacyFolderContextMenu
Root: {#SoftwareClassesRootKey}; Subkey: "Software\Classes\Drive\shell\{#RegValueName}\command"; ValueType: expandsz; ValueName: ""; ValueData: """{app}\{#ExeBasename}.exe"" ""%V"""; Check: ShouldInstallLegacyFolderContextMenu

; Environment
#if "user" == InstallTarget
#define EnvironmentRootKey "HKCU"
#define EnvironmentKey "Environment"
#define Uninstall64RootKey "HKCU64"
#define Uninstall32RootKey "HKCU32"
#else
#define EnvironmentRootKey "HKLM"
#define EnvironmentKey "System\CurrentControlSet\Control\Session Manager\Environment"
#define Uninstall64RootKey "HKLM64"
#define Uninstall32RootKey "HKLM32"
#endif

Root: {#EnvironmentRootKey}; Subkey: "{#EnvironmentKey}"; ValueType: expandsz; ValueName: "Path"; ValueData: "{code:AddToPath|{app}\bin}"; Tasks: addtopath; Check: NeedsAddToPath(ExpandConstant('{app}\bin'))

; App Paths - allows running code from Explorer address bar
Root: {#EnvironmentRootKey}; Subkey: "Software\Microsoft\Windows\CurrentVersion\App Paths\{#ApplicationName}.exe"; ValueType: string; ValueName: ""; ValueData: "{app}\{#ExeBasename}.exe"; Flags: uninsdeletekey
; Remove the "Path" value previously written here; ShellExecute appends it to the launched process PATH, polluting the env. Default value above is enough to resolve `code` from Explorer/Run.
Root: {#EnvironmentRootKey}; Subkey: "Software\Microsoft\Windows\CurrentVersion\App Paths\{#ApplicationName}.exe"; ValueType: none; ValueName: "Path"; Flags: deletevalue

[Code]
function IsBackgroundUpdate(): Boolean;
begin
  Result := ExpandConstant('{param:update|false}') <> 'false';
end;

function IsNotBackgroundUpdate(): Boolean;
begin
  Result := not IsBackgroundUpdate();
end;

function IsVersionedUpdate(): Boolean;
begin
  Result := '{#VersionedResourcesFolder}' <> '';
end;

// Don't allow installing conflicting architectures
function InitializeSetup(): Boolean;
var
  RegKey: String;
  ThisArch: String;
  AltArch: String;
begin
  Result := True;

  #if "user" == InstallTarget
    if not WizardSilent() and IsAdmin() then begin
      if MsgBox('This User Installer is not meant to be run as an Administrator. If you would like to install VS Code for all users in this system, download the System Installer instead from https://code.visualstudio.com. Are you sure you want to continue?', mbError, MB_OKCANCEL) = IDCANCEL then begin
        Result := False;
      end;
    end;
  #endif

  #if "user" == InstallTarget
    #if "arm64" == Arch
      #define IncompatibleArchRootKey "HKLM32"
    #else
      #define IncompatibleArchRootKey "HKLM64"
    #endif

    if Result and not WizardSilent() then begin
      RegKey := 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\' + copy('{#IncompatibleTargetAppId}', 2, 38) + '_is1';

      if RegKeyExists({#IncompatibleArchRootKey}, RegKey) then begin
        if MsgBox('{#NameShort} is already installed on this system for all users. We recommend first uninstalling that version before installing this one. Are you sure you want to continue the installation?', mbConfirmation, MB_YESNO) = IDNO then begin
          Result := False;
        end;
      end;
    end;
  #endif

end;

function WizardNotSilent(): Boolean;
begin
  Result := not WizardSilent();
end;

// Updates

function GetUpdateProgressFilePath(): String;
begin
  Result := ExpandConstant('{param:progress}');
end;

var
  LastReportedProgressPct: Integer;

procedure CurInstallProgressChanged(CurProgress, MaxProgress: Integer);
var
  ProgressFilePath: String;
  ProgressContent: String;
  CurrentPct: Integer;
begin
  if IsBackgroundUpdate() then begin
    ProgressFilePath := GetUpdateProgressFilePath();
    if ProgressFilePath <> '' then begin
      if MaxProgress > 0 then
        CurrentPct := (CurProgress * 100) div MaxProgress
      else
        CurrentPct := 0;
      if CurrentPct <> LastReportedProgressPct then begin
        LastReportedProgressPct := CurrentPct;
        ProgressContent := IntToStr(CurProgress) + ',' + IntToStr(MaxProgress);
        SaveStringToFile(ProgressFilePath, ProgressContent, False);
      end;
    end;
  end;
end;

var
	ShouldRestartTunnelService: Boolean;

function StopTunnelOtherProcesses(): Boolean;
var
	WaitCounter: Integer;
	TaskKilled: Integer;
begin
	Log('Stopping all tunnel services (at ' + ExpandConstant('"{app}\bin\{#TunnelApplicationName}.exe"') + ')');
	ShellExec('', 'powershell.exe', '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "Get-WmiObject Win32_Process | Where-Object { $_.ExecutablePath -eq ' + ExpandConstant('''{app}\bin\{#TunnelApplicationName}.exe''') + ' } | Select @{Name=''Id''; Expression={$_.ProcessId}} | Stop-Process -Force"', '', SW_HIDE, ewWaitUntilTerminated, TaskKilled)

	WaitCounter := 10;
	while (WaitCounter > 0) and CheckForMutexes('{#TunnelMutex}') do
	begin
		Log('Tunnel process is is still running, waiting');
		Sleep(500);
		WaitCounter := WaitCounter - 1
	end;

	if CheckForMutexes('{#TunnelMutex}') then
		begin
			Log('Unable to stop tunnel processes');
			Result := False;
		end
	else
		Result := True;
end;

procedure StopTunnelServiceIfNeeded();
var
	StopServiceResultCode: Integer;
	WaitCounter: Integer;
begin
  ShouldRestartTunnelService := False;
 	if CheckForMutexes('{#TunnelServiceMutex}') then begin
		// stop the tunnel service
		Log('Stopping the tunnel service using ' + ExpandConstant('"{app}\bin\{#ApplicationName}.cmd"'));
		ShellExec('', ExpandConstant('"{app}\bin\{#ApplicationName}.cmd"'), 'tunnel service uninstall', '', SW_HIDE, ewWaitUntilTerminated, StopServiceResultCode);

		Log('Stopping the tunnel service completed with result code ' + IntToStr(StopServiceResultCode));

		WaitCounter := 10;
		while (WaitCounter > 0) and CheckForMutexes('{#TunnelServiceMutex}') do
		begin
			Log('Tunnel service is still running, waiting');
			Sleep(500);
			WaitCounter := WaitCounter - 1
		end;
		if CheckForMutexes('{#TunnelServiceMutex}') then
			Log('Unable to stop tunnel service')
		else
			ShouldRestartTunnelService := True;
	end
end;


// called before the wizard checks for running application
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  if IsNotBackgroundUpdate() then
    StopTunnelServiceIfNeeded();

  if IsNotBackgroundUpdate() and not StopTunnelOtherProcesses() then
     Result := '{#NameShort} is still running a tunnel process. Please stop the tunnel before installing.'
  else
  	Result := '';
end;

// VS Code will create a flag file before the update starts (/update=C:\foo\bar)
// - if the file exists at this point, the user quit Code before the update finished, so don't start Code after update
// - otherwise, the user has accepted to apply the update and Code should start
function LockFileExists(): Boolean;
begin
  Result := FileExists(ExpandConstant('{param:update}'))
end;

// Check if VS Code created a session-end flag file to indicate OS is shutting down
// This prevents calling inno_updater.exe during system shutdown
function SessionEndFileExists(): Boolean;
begin
  Result := FileExists(ExpandConstant('{param:sessionend}'))
end;

function ShouldUpdateShortcut(Path: String): Boolean;
begin
  Result := not (IsBackgroundUpdate() and FileExists(Path));
end;

// Check if VS Code created a cancel file to signal that the update should be aborted
function CancelFileExists(): Boolean;
begin
  Result := FileExists(ExpandConstant('{param:cancel}'))
end;

function ShouldRunAfterUpdate(): Boolean;
begin
  if IsBackgroundUpdate() then
    Result := not LockFileExists()
  else
    Result := True;
end;

function IsWindows11OrLater(): Boolean;
begin
  Result := (GetWindowsVersion >= $0A0055F0);
end;

function IsWindows10ContextMenuForced(): Boolean;
var
  SubKey: String;
begin
  // Check if the user has forced Windows 10 style context menus on Windows 11
  SubKey := 'Software\Classes\CLSID\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\InprocServer32';
  Result := RegKeyExists(HKEY_CURRENT_USER, SubKey);
end;

function ShouldUseWindows11ContextMenu(): Boolean;
begin
  // Use Windows 11 context menu only if:
  // 1. Running on Windows 11 or later
  // 2. User has NOT forced Windows 10 style context menus
  Result := IsWindows11OrLater() and not IsWindows10ContextMenuForced();
end;

function HasLegacyFileContextMenu(): Boolean;
begin
  Result := RegKeyExists({#EnvironmentRootKey}, 'Software\Classes\*\shell\{#RegValueName}\command');
end;

function HasLegacyFolderContextMenu(): Boolean;
begin
  Result := RegKeyExists({#EnvironmentRootKey}, 'Software\Classes\directory\shell\{#RegValueName}\command');
end;

function ShouldRepairFolderContextMenu(): Boolean;
begin
  // Repair folder context menu during updates if:
  // 1. This is a background update (not a fresh install or manual re-install)
  // 2. Windows 11+ with forced classic context menu
  // 3. Legacy file context menu exists (user previously selected it)
  // 4. Legacy folder context menu is MISSING
  Result := IsBackgroundUpdate()
    and IsWindows11OrLater()
    and IsWindows10ContextMenuForced()
    and HasLegacyFileContextMenu()
    and not HasLegacyFolderContextMenu();
end;

function ShouldInstallLegacyFolderContextMenu(): Boolean;
begin
  Result := (WizardIsTaskSelected('addcontextmenufolders') and not ShouldUseWindows11ContextMenu()) or ShouldRepairFolderContextMenu();
end;

function BoolToStr(Value: Boolean): String;
begin
  if Value then
    Result := 'true'
  else
    Result := 'false';
end;

procedure LogContextMenuInstallState();
begin
  Log(
    'Context menu state: '
    + 'isBackgroundUpdate=' + BoolToStr(IsBackgroundUpdate())
    + ', isWindows11OrLater=' + BoolToStr(IsWindows11OrLater())
    + ', isWindows10ContextMenuForced=' + BoolToStr(IsWindows10ContextMenuForced())
    + ', shouldUseWindows11ContextMenu=' + BoolToStr(ShouldUseWindows11ContextMenu())
    + ', hasLegacyFileContextMenu=' + BoolToStr(HasLegacyFileContextMenu())
    + ', hasLegacyFolderContextMenu=' + BoolToStr(HasLegacyFolderContextMenu())
    + ', shouldRepairFolderContextMenu=' + BoolToStr(ShouldRepairFolderContextMenu())
    + ', shouldInstallLegacyFolderContextMenu=' + BoolToStr(ShouldInstallLegacyFolderContextMenu())
    + ', addcontextmenufiles=' + BoolToStr(WizardIsTaskSelected('addcontextmenufiles'))
    + ', addcontextmenufolders=' + BoolToStr(WizardIsTaskSelected('addcontextmenufolders'))
  );
end;

procedure DeleteLegacyContextMenuRegistryKeys();
begin
  RegDeleteKeyIncludingSubkeys({#EnvironmentRootKey}, 'Software\Classes\*\shell\{#RegValueName}');
  RegDeleteKeyIncludingSubkeys({#EnvironmentRootKey}, 'Software\Classes\directory\shell\{#RegValueName}');
  RegDeleteKeyIncludingSubkeys({#EnvironmentRootKey}, 'Software\Classes\directory\background\shell\{#RegValueName}');
  RegDeleteKeyIncludingSubkeys({#EnvironmentRootKey}, 'Software\Classes\Drive\shell\{#RegValueName}');
end;

function GetAppMutex(Value: string): string;
begin
  if IsBackgroundUpdate() then
    Result := ''
  else
    Result := '{#AppMutex}';
end;

function GetSetupMutex(Value: string): string;
begin
  // Always create the base setup mutex to prevent multiple installers running.
  // During background updates, also create a -updating mutex that VS Code checks
  // to avoid launching while an update is in progress.
  if IsBackgroundUpdate() then
    Result := '{#AppMutex}setup,{#AppMutex}-updating'
  else
    Result := '{#AppMutex}setup';
end;

function GetDestDir(Value: string): string;
begin
  if IsBackgroundUpdate() and not IsVersionedUpdate() then
    Result := ExpandConstant('{app}\_')
  else
    Result := ExpandConstant('{app}');
end;

function GetVisualElementsManifest(Value: string): string;
begin
  if IsBackgroundUpdate() and IsVersionedUpdate() then
    Result := ExpandConstant('new_{#ExeBasename}.VisualElementsManifest.xml')
  else
    Result := ExpandConstant('{#ExeBasename}.VisualElementsManifest.xml');
end;

function GetExeBasename(Value: string): string;
begin
  if IsBackgroundUpdate() and IsVersionedUpdate() then
    Result := ExpandConstant('new_{#ExeBasename}.exe')
  else
    Result := ExpandConstant('{#ExeBasename}.exe');
end;

function GetBinDirTunnelApplicationFilename(Value: string): string;
begin
  if IsBackgroundUpdate() and IsVersionedUpdate() then
    Result := ExpandConstant('new_{#TunnelApplicationName}.exe')
  else
    Result := ExpandConstant('{#TunnelApplicationName}.exe');
end;

function GetBinDirApplicationFilename(Value: string): string;
begin
  if IsBackgroundUpdate() and IsVersionedUpdate() then
    Result := ExpandConstant('new_{#ApplicationName}')
  else
    Result := ExpandConstant('{#ApplicationName}');
end;

function GetBinDirApplicationCmdFilename(Value: string): string;
begin
  if IsBackgroundUpdate() and IsVersionedUpdate() then
    Result := ExpandConstant('new_{#ApplicationName}.cmd')
  else
    Result := ExpandConstant('{#ApplicationName}.cmd');
end;

function QualityIsInsiders(): boolean;
begin
  if '{#Quality}' = 'insider' then
    Result := True
  else
    Result := False;
end;

// Unblock inno_updater --gc when our context-menu COM surrogate keeps a
// handle on the orphan commit folder. See https://github.com/microsoft/vscode/issues/294546.
// No-op when FileExplorerContextMenuCLSID is not defined (e.g. OSS builds).
procedure KillContextMenuComSurrogate();
var
  KillErrorCode: Integer;
  Command: String;
begin
#ifdef FileExplorerContextMenuCLSID
  Log('KillContextMenuComSurrogate: stopping COM surrogate(s) hosting context-menu DLL ({#FileExplorerContextMenuCLSID})');

  Command :=
    '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command "' +
    'Get-CimInstance Win32_Process -Filter ""Name = ''dllhost.exe''"" | ' +
    'Where-Object { $_.CommandLine -like ''*/Processid:{#FileExplorerContextMenuCLSID}*'' } | ' +
    'ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop } catch {} }"';

  if not ShellExec('', 'powershell.exe', Command, '', SW_HIDE, ewWaitUntilTerminated, KillErrorCode) then
    Log('KillContextMenuComSurrogate: ShellExec failed with error code ' + IntToStr(KillErrorCode))
  else if KillErrorCode <> 0 then
    Log('KillContextMenuComSurrogate: PowerShell exited with non-zero code ' + IntToStr(KillErrorCode))
  else
    Log('KillContextMenuComSurrogate: complete');
#endif
end;

#ifdef AppxPackageName
var
  AppxPackageFullname: String;

procedure ExecAndGetFirstLineLog(const S: String; const Error, FirstLine: Boolean);
begin
  if not Error and (AppxPackageFullname = '') and (Trim(S) <> '') then
    AppxPackageFullname := S;
  Log(S);
end;

function AppxPackageInstalled(const name: String; var ResultCode: Integer): Boolean;
begin
  AppxPackageFullname := '';
  ResultCode := -1;
  try
    Log('Get-AppxPackage for package with name: ' + name);
    ExecAndLogOutput('powershell.exe', '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command ' + AddQuotes('Get-AppxPackage -Name ''' + name + ''' | Select-Object -ExpandProperty PackageFullName'), '', SW_HIDE, ewWaitUntilTerminated, ResultCode, @ExecAndGetFirstLineLog);
  except
    Log(GetExceptionMessage);
    ResultCode := -1;
  end;
  if (AppxPackageFullname <> '') then
    Result := True
  else
    Result := False;

  Log('Get-AppxPackage result: name=' + name + ', installed=' + BoolToStr(Result) + ', resultCode=' + IntToStr(ResultCode) + ', packageFullName=' + AppxPackageFullname);
end;

procedure AddAppxPackage();
var
  AddAppxPackageResultCode: Integer;
  IsCurrentAppxInstalled: Boolean;
begin
  if SessionEndFileExists() then begin
    Log('Skipping Add-AppxPackage because session end was detected.');
    exit;
  end;

  IsCurrentAppxInstalled := AppxPackageInstalled(ExpandConstant('{#AppxPackageName}'), AddAppxPackageResultCode);
  if not IsCurrentAppxInstalled then begin
    Log('Installing appx ' + AppxPackageFullname + ' ...');
#if "user" == InstallTarget
    ShellExec('', 'powershell.exe', '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command ' + AddQuotes('Add-AppxPackage -Path ''' + ExpandConstant('{app}\{#VersionedResourcesFolder}\appx\{#AppxPackage}') + ''' -ExternalLocation ''' + ExpandConstant('{app}\{#VersionedResourcesFolder}\appx') + ''''), '', SW_HIDE, ewWaitUntilTerminated, AddAppxPackageResultCode);
#else
    ShellExec('', 'powershell.exe', '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command ' + AddQuotes('Add-AppxPackage -Stage ''' + ExpandConstant('{app}\{#VersionedResourcesFolder}\appx\{#AppxPackage}') + ''' -ExternalLocation ''' + ExpandConstant('{app}\{#VersionedResourcesFolder}\appx') + '''; Add-AppxProvisionedPackage -Online -SkipLicense -PackagePath ''' + ExpandConstant('{app}\{#VersionedResourcesFolder}\appx\{#AppxPackage}') + ''''), '', SW_HIDE, ewWaitUntilTerminated, AddAppxPackageResultCode);
#endif
    Log('Add-AppxPackage complete with result code ' + IntToStr(AddAppxPackageResultCode) + '.');
  end else begin
    Log('Skipping Add-AppxPackage because package is already installed.');
  end;
end;

procedure RemoveAppxPackage();
var
  RemoveAppxPackageResultCode: Integer;
begin
  KillContextMenuComSurrogate();
  // Remove the old context menu package
  // Following condition can be removed in v1.111.
  if QualityIsInsiders() and not SessionEndFileExists() and AppxPackageInstalled('Microsoft.VSCodeInsiders', RemoveAppxPackageResultCode) then begin
    Log('Deleting old appx ' + AppxPackageFullname + ' installation...');
    ShellExec('', 'powershell.exe', '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command ' + AddQuotes('Remove-AppxPackage -Package ''' + AppxPackageFullname + ''''), '', SW_HIDE, ewWaitUntilTerminated, RemoveAppxPackageResultCode);
    Log('Remove-AppxPackage for old appx completed with result code ' + IntToStr(RemoveAppxPackageResultCode) + '.');
    DeleteFile(ExpandConstant('{app}\appx\code_insiders_explorer_{#Arch}.appx'));
    DeleteFile(ExpandConstant('{app}\appx\code_insiders_explorer_command.dll'));
  end;
  if not SessionEndFileExists() and AppxPackageInstalled(ExpandConstant('{#AppxPackageName}'), RemoveAppxPackageResultCode) then begin
    Log('Removing current ' + AppxPackageFullname + ' appx installation...');
#if "user" == InstallTarget
    ShellExec('', 'powershell.exe', '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command ' + AddQuotes('Remove-AppxPackage -Package ''' + AppxPackageFullname + ''''), '', SW_HIDE, ewWaitUntilTerminated, RemoveAppxPackageResultCode);
#else
    ShellExec('', 'powershell.exe', '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -Command ' + AddQuotes('$packages = Get-AppxPackage ''' + ExpandConstant('{#AppxPackageName}') + '''; foreach ($package in $packages) { Remove-AppxProvisionedPackage -PackageName $package.PackageFullName -Online }; foreach ($package in $packages) { Remove-AppxPackage -Package $package.PackageFullName -AllUsers }'), '', SW_HIDE, ewWaitUntilTerminated, RemoveAppxPackageResultCode);
#endif
    Log('Remove-AppxPackage for current appx installation complete with result code ' + IntToStr(RemoveAppxPackageResultCode) + '.');
  end else if not SessionEndFileExists() then begin
    Log('Skipping Remove-AppxPackage for current appx because package is not installed.');
  end;
end;
#endif

procedure CurStepChanged(CurStep: TSetupStep);
var
  UpdateResultCode: Integer;
	StartServiceResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    LogContextMenuInstallState();

#ifdef AppxPackageName
    // Remove the appx package when user has forced Windows 10 context menus via
    // registry. This handles the case where the user previously had the appx
    // installed but now wants the classic context menu style.
    if IsWindows10ContextMenuForced() then begin
      RemoveAppxPackage();
    end;
    // Remove the old context menu registry keys
    if ShouldUseWindows11ContextMenu() then begin
      DeleteLegacyContextMenuRegistryKeys();
    end;
#endif

    if IsBackgroundUpdate() then
    begin
      SaveStringToFile(ExpandConstant('{app}\updating_version'), '{#Commit}', False);
      CreateMutex('{#AppMutex}-ready');
      DeleteFile(GetUpdateProgressFilePath());

      Log('Checking whether application is still running...');
      while (CheckForMutexes('{#AppMutex}')) do
      begin
        if CancelFileExists() then
        begin
          Log('Cancel file detected, aborting background update.');
          DeleteFile(ExpandConstant('{app}\updating_version'));
          Abort;
        end;
        Sleep(1000)
      end;
      Log('Application appears not to be running.');

      if not SessionEndFileExists() and not CancelFileExists() then begin
        StopTunnelServiceIfNeeded();
        Log('Invoking inno_updater for background update');
        Exec(ExpandConstant('{app}\{#VersionedResourcesFolder}\tools\inno_updater.exe'), ExpandConstant('"{app}\{#ExeBasename}.exe" ' + BoolToStr(LockFileExists()) + ' "{cm:UpdatingVisualStudioCode}"'), '', SW_SHOW, ewWaitUntilTerminated, UpdateResultCode);
        DeleteFile(ExpandConstant('{app}\updating_version'));
        Log('inno_updater completed successfully');
        #if "system" == InstallTarget
          if IsVersionedUpdate() then begin
            KillContextMenuComSurrogate();
            Log('Invoking inno_updater to remove previous installation folder');
            Exec(ExpandConstant('{app}\{#VersionedResourcesFolder}\tools\inno_updater.exe'), ExpandConstant('"--gc" "{app}\{#ExeBasename}.exe" "{#VersionedResourcesFolder}" "{#ExeBasename}.exe"'), '', SW_SHOW, ewWaitUntilTerminated, UpdateResultCode);
            Log('inno_updater completed gc successfully');
          end;
        #endif
      end else begin
        Log('Skipping inno_updater.exe call because OS session is ending or cancel was requested');
      end;
    end else begin
      if IsVersionedUpdate() then begin
        KillContextMenuComSurrogate();
        Log('Invoking inno_updater to remove previous installation folder');
        Exec(ExpandConstant('{app}\{#VersionedResourcesFolder}\tools\inno_updater.exe'), ExpandConstant('"--gc" "{app}\{#ExeBasename}.exe" "{#VersionedResourcesFolder}" "{#ExeBasename}.exe"'), '', SW_SHOW, ewWaitUntilTerminated, UpdateResultCode);
        Log('inno_updater completed gc successfully');
      end;
    end;

    if ShouldRestartTunnelService then
    begin
      // start the tunnel service
      Log('Restarting the tunnel service...');
      ShellExec('', ExpandConstant('"{app}\bin\{#ApplicationName}.cmd"'), 'tunnel service install', '', SW_HIDE, ewWaitUntilTerminated, StartServiceResultCode);
      Log('Starting the tunnel service completed with result code ' + IntToStr(StartServiceResultCode));
      ShouldRestartTunnelService := False
    end;
  end;
end;

// https://stackoverflow.com/a/23838239/261019
procedure Explode(var Dest: TArrayOfString; Text: String; Separator: String);
var
  i, p: Integer;
begin
  i := 0;
  repeat
    SetArrayLength(Dest, i+1);
    p := Pos(Separator,Text);
    if p > 0 then begin
      Dest[i] := Copy(Text, 1, p-1);
      Text := Copy(Text, p + Length(Separator), Length(Text));
      i := i + 1;
    end else begin
      Dest[i] := Text;
      Text := '';
    end;
  until Length(Text)=0;
end;

function NeedsAddToPath(VSCode: string): boolean;
var
  OrigPath: string;
begin
  if not RegQueryStringValue({#EnvironmentRootKey}, '{#EnvironmentKey}', 'Path', OrigPath)
  then begin
    Result := True;
    exit;
  end;
  Result := Pos(';' + VSCode + ';', ';' + OrigPath + ';') = 0;
end;

function AddToPath(VSCode: string): string;
var
  OrigPath: string;
begin
  RegQueryStringValue({#EnvironmentRootKey}, '{#EnvironmentKey}', 'Path', OrigPath)

  if (Length(OrigPath) > 0) and (OrigPath[Length(OrigPath)] = ';') then
    Result := OrigPath + VSCode
  else
    Result := OrigPath + ';' + VSCode
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Path: string;
  VSCodePath: string;
  Parts: TArrayOfString;
  NewPath: string;
  i: Integer;
begin
  if not CurUninstallStep = usUninstall then begin
    exit;
  end;

#ifdef AppxPackageName
  RemoveAppxPackage();
#endif
  if not RegQueryStringValue({#EnvironmentRootKey}, '{#EnvironmentKey}', 'Path', Path)
  then begin
    exit;
  end;
  NewPath := '';
  VSCodePath := ExpandConstant('{app}\bin')
  Explode(Parts, Path, ';');
  for i:=0 to GetArrayLength(Parts)-1 do begin
    if CompareText(Parts[i], VSCodePath) <> 0 then begin
      NewPath := NewPath + Parts[i];

      if i < GetArrayLength(Parts) - 1 then begin
        NewPath := NewPath + ';';
      end;
    end;
  end;
  RegWriteExpandStringValue({#EnvironmentRootKey}, '{#EnvironmentKey}', 'Path', NewPath);
end;

#ifdef Debug
  #expr SaveToFile(AddBackslash(SourcePath) + "code-processed.iss")
#endif

// https://docs.microsoft.com/en-us/windows-server/administration/windows-commands/icacls
// https://docs.microsoft.com/en-US/windows/security/identity-protection/access-control/security-identifiers
procedure DisableAppDirInheritance();
var
  ResultCode: Integer;
  Permissions: string;
begin
  Permissions := '/grant:r "*S-1-5-18:(OI)(CI)F" /grant:r "*S-1-5-32-544:(OI)(CI)F" /grant:r "*S-1-5-11:(OI)(CI)RX" /grant:r "*S-1-5-32-545:(OI)(CI)RX"';

  #if "user" == InstallTarget
    Permissions := Permissions + Format(' /grant:r "*S-1-3-0:(OI)(CI)F" /grant:r "%s:(OI)(CI)F"', [GetUserNameString()]);
  #endif

  Exec(ExpandConstant('{sys}\icacls.exe'), ExpandConstant('"{app}" /inheritancelevel:r ') + Permissions, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
