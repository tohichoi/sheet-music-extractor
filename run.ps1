# Start Backend and Frontend in separate windows
Write-Host "Starting Sheet Music Extractor..." -ForegroundColor Cyan

# Determine if PowerShell Core (pwsh) or Windows PowerShell (powershell) is available
$shell = if (Get-Command pwsh -ErrorAction SilentlyContinue) { "pwsh" } else { "powershell" }

# Start Backend (Uvicorn)
Write-Host "Starting Backend (Uvicorn)..." -ForegroundColor Green
Start-Process $shell -ArgumentList "-NoExit", "-Command", "Set-Location '$PSScriptRoot/backend'; uv run uvicorn app.main:app --reload"

# Start Frontend (Vite)
Write-Host "Starting Frontend (Vite)..." -ForegroundColor Green
Start-Process $shell -ArgumentList "-NoExit", "-Command", "Set-Location '$PSScriptRoot/frontend'; npm run dev"

Write-Host "Backend and Frontend have been started in separate windows." -ForegroundColor Cyan
