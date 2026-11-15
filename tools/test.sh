#!/bin/bash
# Runs every headless check. Exit code is non-zero if anything fails (use before each commit).
#   1. import (so new class names and assets are known)
#   2. the runner: every .gd file compiles (with autoloads present), then the test suites in tests/
# GODOT can point at the engine binary; otherwise the usual macOS locations and PATH are tried.
set -uo pipefail
cd "$(dirname "$0")/.."
G="${GODOT:-}"
for c in "$G" "$HOME/Downloads/Godot.app/Contents/MacOS/Godot" "/Applications/Godot.app/Contents/MacOS/Godot" "$(command -v godot || true)" "$(command -v godot4 || true)"; do
  if [ -n "$c" ] && [ -x "$c" ]; then G="$c"; break; fi
done
[ -x "$G" ] || { echo "Godot not found. Set GODOT=/path/to/godot"; exit 2; }

"$G" --headless --path . --import >/dev/null 2>&1 || true


"$G" --headless --path . --script res://tests/run_tests.gd -- "$@" 2>&1 | grep -v -E "^Godot Engine v|^$"
exit "${PIPESTATUS[0]}"
