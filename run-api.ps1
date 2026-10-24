# Run FastAPI from repo root (app package lives in backend/)
Set-Location $PSScriptRoot
if (-not (Test-Path "backend\.venv\Scripts\Activate.ps1")) {
    Write-Host "Tip: create backend\.venv and pip install -r backend\requirements.txt"
}
uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
