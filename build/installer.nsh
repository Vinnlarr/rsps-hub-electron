!macro customCloseApplications
  ; Force-kill RSPS Hub and Java before NSIS checks for running processes
  nsExec::ExecToLog 'cmd /c taskkill /F /IM "RSPS Hub.exe" /T 2>nul'
  nsExec::ExecToLog 'cmd /c taskkill /F /IM java.exe /T 2>nul'
  nsExec::ExecToLog 'cmd /c taskkill /F /IM javaw.exe /T 2>nul'
  Sleep 1500
  ; Remove legacy rsps-hub install directory from old versions
  RMDir /r "$LOCALAPPDATA\Programs\rsps-hub"
!macroend

!macro customUnInstall
  ; Kill any running launcher / Java processes so the file deletion below
  ; isn't blocked by open handles. Do NOT delete %APPDATA%\RSPS Hub or
  ; ~/.rsps_hub here — auto-update runs this same uninstall block as part
  ; of installing a new version, and wiping the data dir was logging users
  ; out + re-downloading every cached server JAR on every patch.
  ;
  ; Users who genuinely want a clean reset can manually delete:
  ;   %APPDATA%\RSPS Hub
  ;   %USERPROFILE%\.rsps_hub
  nsExec::ExecToLog 'cmd /c taskkill /F /IM "RSPS Hub.exe" /T 2>nul'
  nsExec::ExecToLog 'cmd /c taskkill /F /IM java.exe /T 2>nul'
  nsExec::ExecToLog 'cmd /c taskkill /F /IM javaw.exe /T 2>nul'
  Sleep 1000
!macroend
