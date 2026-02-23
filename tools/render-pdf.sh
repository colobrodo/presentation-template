#!/bin/bash

# Script to render a Reveal.js presentation to PDF
# This script starts a local HTTP server, captures the presentation, and generates a PDF

set -e

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RENDER_TOOL="$SCRIPT_DIR/render-revealjs/render-revealjs.js"

# Check if render-revealjs tool exists
if [ ! -f "$RENDER_TOOL" ]; then
    echo "Error: render-revealjs.js not found at $RENDER_TOOL" >&2
    echo "Make sure render-revealjs dependencies are installed: cd $SCRIPT_DIR/render-revealjs && npm install" >&2
    exit 1
fi

# Default port (can be overridden with --port)
port=8080

# Parse optional port argument
while [[ $# -gt 0 ]]; do
    case $1 in
        --port)
            port="$2"
            shift 2
            ;;
        *)
            break
            ;;
    esac
done

# Get the parent directory (where presentation.md is located)
PRESENTATION_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Change to presentation directory
cd "$PRESENTATION_DIR"

# Start HTTP server in the background
echo "Starting HTTP server on port $port..." >&2
python3 -m http.server $port >/dev/null 2>&1 &
server_pid=$!

# Cleanup on exit
cleanup() {
    echo "Stopping HTTP server..." >&2
    kill -9 $server_pid 2>/dev/null || true
}
trap cleanup EXIT

# Wait for server to start
sleep 1

# Run render-revealjs
echo "Rendering presentation to PDF..." >&2
node "$RENDER_TOOL" "$@" http://localhost:$port/presentation.html presentation.pdf

echo "Done!" >&2

