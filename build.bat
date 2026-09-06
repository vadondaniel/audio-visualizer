@echo off
setlocal

if not exist node_modules (
    echo Installing dependencies from package-lock.json...
    call npm ci
    if errorlevel 1 goto :error
)

if /I "%~1"=="--clean" (
    if exist dist rmdir /s /q dist
    echo Cleaned dist folder.
)

if /I "%~1"=="--diagnose" (
    echo Checking project...
    call npm run format:check
    if errorlevel 1 goto :error
    if exist dist (
        echo.
        echo Existing build sizes:
        powershell -NoProfile -Command "Get-ChildItem -File dist | Sort-Object Length -Descending | Select-Object Name,@{N='MB';E={[math]::Round($_.Length/1MB,2)}} | Format-Table -AutoSize"
    )
    exit /b 0
)

echo Building portable .exe...
call npm run dist
if errorlevel 1 goto :error

echo.
echo Build complete:
powershell -NoProfile -Command "Get-ChildItem -File dist | Sort-Object Length -Descending | Select-Object Name,@{N='MB';E={[math]::Round($_.Length/1MB,2)}} | Format-Table -AutoSize"
exit /b 0

:error
echo.
echo Build failed - see the error above.
exit /b 1
