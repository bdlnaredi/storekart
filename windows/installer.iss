; Windows installer (Inno Setup 6). Built by GitHub Actions; by hand:
;   iscc /DAppName=Dukaan /DAppTitle=Dukaan /DAppVersion=1.0.0.0 /DAppId=... /DServerExe=Dukaan.exe windows\installer.iss
; Optional: /DKiosk=1 adds the "self-order screen" shortcut.

#ifndef AppName
  #error Pass /DAppName=...
#endif
#ifndef AppTitle
  #define AppTitle AppName
#endif
#ifndef ServerPath
  #define ServerPath ServerExe
#endif
#define SrcDir "..\dist\" + AppName

[Setup]
AppId={#AppId}
AppName={#AppTitle}
AppVersion={#AppVersion}
VersionInfoVersion={#AppVersion}
AppPublisher=bdlnaredi
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppTitle}
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename={#AppName}-Setup
SetupIconFile={#SrcDir}\app.ico
UninstallDisplayIcon={app}\{#AppName}.exe
UninstallDisplayName={#AppTitle}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=no

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#SrcDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[InstallDelete]
Type: filesandordirs; Name: "{app}\_internal"
Type: filesandordirs; Name: "{app}\server"

[Icons]
Name: "{autoprograms}\{#AppTitle}"; Filename: "{app}\{#AppName}.exe"
Name: "{autoprograms}\{#AppTitle} - change setup"; Filename: "{app}\{#AppName}.exe"; Parameters: "--setup"
#ifdef Kiosk
Name: "{autoprograms}\{#AppTitle} self-order screen"; Filename: "{app}\{#AppName}.exe"; Parameters: "--kiosk"
#endif
Name: "{autodesktop}\{#AppTitle}"; Filename: "{app}\{#AppName}.exe"; Tasks: desktopicon

[Run]
; Let phones and other computers on the shop's network reach the app.
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""{#AppName}"""; Flags: runhidden
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall add rule name=""{#AppName}"" dir=in action=allow program=""{app}\{#ServerPath}"" enable=yes"; Flags: runhidden
Filename: "{app}\{#AppName}.exe"; Description: "Open {#AppTitle}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM {#AppName}.exe"; Flags: runhidden; RunOnceId: "StopApp"
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM {#ServerExe}"; Flags: runhidden; RunOnceId: "StopServer"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=""{#AppName}"""; Flags: runhidden; RunOnceId: "Firewall"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: none; ValueName: "{#AppName}"; Flags: uninsdeletevalue dontcreatekey

[Code]
// Close a running copy before updating it (your data in %LOCALAPPDATA% is never touched).
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM {#AppName}.exe', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM {#ServerExe}', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Sleep(800);
  Result := '';
end;
