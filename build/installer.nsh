!macro customInit
  ; Runs BEFORE the existing uninstaller is invoked. v1.0.51 and earlier
  ; had a customUnInstall block that wiped ~/.rsps_hub on every update.
  ; Stash the session + downloaded JARs in TEMP first so they survive the
  ; old uninstaller, then customInstall puts them back. After everyone
  ; upgrades past v1.0.52, the new (non-wiping) uninstaller takes over and
  ; this dance is a no-op.
  CreateDirectory "$TEMP\rspshub_migrate"
  CopyFiles /SILENT "$PROFILE\.rsps_hub\session.json"     "$TEMP\rspshub_migrate\session.json"
  CopyFiles /SILENT "$PROFILE\.rsps_hub\settings.json"    "$TEMP\rspshub_migrate\settings.json"
  CopyFiles /SILENT "$PROFILE\.rsps_hub\playtime.json"    "$TEMP\rspshub_migrate\playtime.json"
!macroend

!macro customInstall
  ; Restore the files we stashed in customInit, but only if .rsps_hub got
  ; wiped during the update (i.e. the file we backed up is gone). Skip the
  ; copy back if the file is still there to avoid clobbering newer state.
  IfFileExists "$PROFILE\.rsps_hub\session.json"  skipSessionRestore restoreSession
  restoreSession:
    CreateDirectory "$PROFILE\.rsps_hub"
    CopyFiles /SILENT "$TEMP\rspshub_migrate\session.json"  "$PROFILE\.rsps_hub\session.json"
  skipSessionRestore:
  IfFileExists "$PROFILE\.rsps_hub\settings.json" skipSettingsRestore restoreSettings
  restoreSettings:
    CopyFiles /SILENT "$TEMP\rspshub_migrate\settings.json" "$PROFILE\.rsps_hub\settings.json"
  skipSettingsRestore:
  IfFileExists "$PROFILE\.rsps_hub\playtime.json" skipPlaytimeRestore restorePlaytime
  restorePlaytime:
    CopyFiles /SILENT "$TEMP\rspshub_migrate\playtime.json" "$PROFILE\.rsps_hub\playtime.json"
  skipPlaytimeRestore:
  ; clean up the temp stash
  RMDir /r "$TEMP\rspshub_migrate"
!macroend

!macro customCloseApplications
  ; Force-kill RSPS Hub itself. /T also kills its child tree so the
  ; Electron renderer and any helper processes go too.
  nsExec::ExecToLog 'cmd /c taskkill /F /IM "RSPS Hub.exe" /T 2>nul'

  ; Kill ONLY our Java backend (the one running RSPSHub.jar). Earlier
  ; releases killed every java.exe / javaw.exe on the system, which took
  ; down unrelated apps (RSPS server owners running their own clients,
  ; IntelliJ, etc). We now filter on the command line so other Java apps
  ; survive the update.
  ; $$ escapes the NSIS dollar-sign parser so PowerShell sees a literal
  ; $_ pipeline variable. Without escaping, NSIS treats $_ as one of its
  ; own variables, emits "warning 6000: unknown variable", and with
  ; warnings-treated-as-errors the build fails.
  nsExec::ExecToLog `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { ($$_.Name -eq 'java.exe' -or $$_.Name -eq 'javaw.exe') -and $$_.CommandLine -like '*RSPSHub.jar*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`

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

  ; Kill ONLY our Java backend (RSPSHub.jar), not every Java process on
  ; the system. Same filter as customCloseApplications — earlier
  ; releases nuked IntelliJ / unrelated RSPS clients during update
  ; because the broad taskkill ran in this uninstall path too.
  ; $$ escapes the NSIS dollar-sign parser so PowerShell sees a literal
  ; $_ pipeline variable. Without escaping, NSIS treats $_ as one of its
  ; own variables, emits "warning 6000: unknown variable", and with
  ; warnings-treated-as-errors the build fails.
  nsExec::ExecToLog `powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { ($$_.Name -eq 'java.exe' -or $$_.Name -eq 'javaw.exe') -and $$_.CommandLine -like '*RSPSHub.jar*' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"`

  Sleep 1000
!macroend
