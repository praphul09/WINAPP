@echo off
setlocal

set "ROOT_DIR=%~dp0"
set "ELECTRON_CMD=%ROOT_DIR%node_modules\.bin\electron.cmd"

if not exist "%ELECTRON_CMD%" (
  echo Electron is not installed yet.
  echo Run: npm install
  exit /b 1
)

call "%ELECTRON_CMD%" "%ROOT_DIR%"

