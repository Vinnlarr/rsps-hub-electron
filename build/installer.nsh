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
  ; Wipe per-user state on uninstall so reinstalling gives a fresh launcher,
  ; not "logged into the same account with the same cached server list".
  ; Covers Electron user-data (session token, settings, cookies, localStorage)
  ; and the per-user JAR cache + downloaded server folders. Without this,
  ; users have to manually purge AppData and ~/.rsps_hub/ to actually reset.
  nsExec::ExecToLog 'cmd /c taskkill /F /IM "RSPS Hub.exe" /T 2>nul'
  nsExec::ExecToLog 'cmd /c taskkill /F /IM java.exe /T 2>nul'
  nsExec::ExecToLog 'cmd /c taskkill /F /IM javaw.exe /T 2>nul'
  Sleep 1000
  ; Electron user-data folder under APPDATA
  RMDir /r "$APPDATA\RSPS Hub"
  ; JAR + per-server install cache under USERPROFILE
  RMDir /r "$PROFILE\.rsps_hub"
!macroend
