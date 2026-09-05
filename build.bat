@echo off
echo Installing dependencies...
call npm install
if errorlevel 1 goto :error

echo Building portable .exe...
call npm run dist
if errorlevel 1 goto :error

echo.
echo Done. Find it in the dist folder.
pause
exit /b 0

:error
echo.
echo Build failed - see the error above.
pause
exit /b 1
