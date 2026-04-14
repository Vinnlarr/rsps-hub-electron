@echo off
setlocal

set SCRIPT_DIR=%~dp0
set JAVA_PROJECT=%SCRIPT_DIR%..\RSPS-Hub-Launcher-main
set JAVA_INSTALL=%JAVA_PROJECT%\build\install\RSPSHub
set JAVA_BACKEND=%SCRIPT_DIR%java-backend

echo ============================================
echo  RSPS Hub - Full Build
echo ============================================

:: Step 1 — Build Java backend
echo.
echo [1/3] Building Java backend...
cd /d "%JAVA_PROJECT%"
call gradlew.bat installDist
if errorlevel 1 (
    echo ERROR: Java build failed.
    exit /b 1
)
echo Java backend built.

:: Step 2 — Copy Java backend into Electron project
echo.
echo [2/3] Copying Java backend to Electron project...
cd /d "%SCRIPT_DIR%"
if exist "%JAVA_BACKEND%" rmdir /s /q "%JAVA_BACKEND%"
xcopy /e /i /q "%JAVA_INSTALL%" "%JAVA_BACKEND%"
if errorlevel 1 (
    echo ERROR: Failed to copy Java backend.
    exit /b 1
)
echo Java backend copied.

:: Step 3 — Build Electron installer
echo.
echo [3/3] Building Electron installer...
call npm run build
if errorlevel 1 (
    echo ERROR: Electron build failed.
    exit /b 1
)

echo.
echo ============================================
echo  Build complete! Installer is in dist\
echo ============================================
