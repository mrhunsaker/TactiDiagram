; TactiDiagram per-user Windows installer.
!ifndef APP_VERSION
  !define APP_VERSION "0.0.0"
!endif
!include "MUI2.nsh"
!define APP_NAME "TactiDiagram"
!define APP_EXE "TactiDiagram.exe"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\TactiDiagram"
Name "${APP_NAME}"
Caption "${APP_NAME} Setup"
OutFile "dist\TactiDiagram-Setup.exe"
InstallDir "$LOCALAPPDATA\Programs\TactiDiagram"
InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallLocation"
RequestExecutionLevel user
Unicode True
SetShellVarContext current
SetCompressor /SOLID lzma
Icon "packaging\icon.ico"
UninstallIcon "packaging\icon.ico"
!define MUI_ABORTWARNING
!define MUI_STARTMENUPAGE_DEFAULTFOLDER "${APP_NAME}"
!define MUI_STARTMENUPAGE_REGISTRY_ROOT HKCU
!define MUI_STARTMENUPAGE_REGISTRY_KEY "Software\TactiDiagram"
!define MUI_STARTMENUPAGE_REGISTRY_VALUENAME "StartMenuFolder"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_STARTMENU Application $StartMenuFolder
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "ProductVersion" "${APP_VERSION}"
VIAddVersionKey "FileDescription" "${APP_NAME} Windows installer"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "LegalCopyright" "Copyright TactiDiagram contributors"

Section "Install"
  SetOutPath "$INSTDIR"
  ; Keep the Neutralino executable and resources.neu side by side.
  File "dist\TactiDiagram-win-x64\TactiDiagram.exe"
  File "dist\TactiDiagram-win-x64\resources.neu"
  File "dist\TactiDiagram-win-x64\README.txt"
  File "packaging\icon.ico"
  WriteUninstaller "$INSTDIR\Uninstall.exe"

  ; Per-user Add/Remove Programs registration (no administrator elevation).
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "TactiDiagram"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\icon.ico"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\Uninstall.exe" /S'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "URLInfoAbout" "https://github.com/mrhunsaker/TactiDiagram"
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1

  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\icon.ico" 0 SW_SHOWNORMAL "" "Launch ${APP_NAME}"
  !insertmacro MUI_STARTMENU_WRITE_BEGIN Application
    CreateDirectory "$SMPROGRAMS\$StartMenuFolder"
    CreateShortcut "$SMPROGRAMS\$StartMenuFolder\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\icon.ico" 0 SW_SHOWNORMAL "" "Launch ${APP_NAME}"
    CreateShortcut "$SMPROGRAMS\$StartMenuFolder\Uninstall ${APP_NAME}.lnk" "$INSTDIR\Uninstall.exe"
  !insertmacro MUI_STARTMENU_WRITE_END
SectionEnd

Section "Uninstall"
  ; Delete only files owned by this installer; preserve unexpected files.
  Delete "$DESKTOP\${APP_NAME}.lnk"
  !insertmacro MUI_STARTMENU_GETFOLDER Application $StartMenuFolder
  Delete "$SMPROGRAMS\$StartMenuFolder\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\$StartMenuFolder\Uninstall ${APP_NAME}.lnk"
  RMDir "$SMPROGRAMS\$StartMenuFolder"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegValue HKCU "Software\TactiDiagram" "StartMenuFolder"
  DeleteRegKey /ifempty HKCU "Software\TactiDiagram"
  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\resources.neu"
  Delete "$INSTDIR\README.txt"
  Delete "$INSTDIR\icon.ico"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
