!macro customCloseApplications
  ; Force-kill RSPS Hub and Java before NSIS checks for running processes
  nsExec::ExecToLog 'cmd /c taskkill /F /IM "RSPS Hub.exe" /T 2>nul'
  nsExec::ExecToLog 'cmd /c taskkill /F /IM java.exe /T 2>nul'
  nsExec::ExecToLog 'cmd /c taskkill /F /IM javaw.exe /T 2>nul'
  Sleep 1500
  ; Remove legacy rsps-hub install directory from old versions
  RMDir /r "$LOCALAPPDATA\Programs\rsps-hub"
!macroend
