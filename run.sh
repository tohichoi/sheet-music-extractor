#!/bin/bash

# Terminate all background processes spawned by this script when it exits (e.g. on Ctrl+C)
trap 'kill 0' EXIT

# Get the directory where this script is located
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Starting Backend (Uvicorn)..."
(cd "$PROJECT_ROOT/backend" && uv run uvicorn app.main:app --reload) &

echo "Starting Frontend (Vite)..."
(cd "$PROJECT_ROOT/frontend" && npm run dev) &

echo "Backend and Frontend started. Press Ctrl+C to stop both."
wait
