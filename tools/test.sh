#!/bin/bash
# Runs every headless check. Exit code is non-zero if anything fails (use before each commit).
#   1. import (so new class names and assets are known)
#   2. every .gd file compiles
#   3. the GDScript test suites in tests/
# GODOT can point at the engine binary; otherwise the usual macOS locations and PATH are tried.
set -uo pipefail
cd "$(dirname "$0")/.."
G="${GODOT:-}"
for c in "$G" "$HOME/Downloads/Godot.app/Contents/MacOS/Godot" "/Applications/Godot.app/Contents/MacOS/Godot" "$(command -v godot || true)" "$(command -v godot4 || true)"; do
  if [ -n "$c" ] && [ -x "$c" ]; then G="$c"; break; fi
done
[ -x "$G" ] || { echo "Godot not found. Set GODOT=/path/to/godot"; exit 2; }

"$G" --headless --path . --import >/dev/null 2>&1 || true

# --check-only does not load autoloads, so "Identifier not found: <autoload>" is the one error it reports falsely.
AUTOLOADS=$(sed -n '/^\[autoload\]/,/^\[/p' project.godot | grep -o '^[A-Za-z]*=' | tr -d '=' | paste -sd'|' -)
bad=0
while IFS= read -r f; do
  errs=$("$G" --headless --path . --check-only --script "res://${f#./}" 2>&1 | grep "SCRIPT ERROR" | grep -v -E "Identifier not found: (${AUTOLOADS})\$" || true)
  if [ -n "$errs" ]; then
    echo "  FAIL  compile: $f"; echo "$errs" | head -3 | sed 's/^/        /'; bad=1
  fi
done < <(find . -name "*.gd" -not -path "./addons/*" -not -path "./.godot/*" | sort)
if [ $bad -ne 0 ]; then echo "compile check failed"; exit 1; fi
echo "  ok    every script compiles"

"$G" --headless --path . --script res://tests/run_tests.gd -- "$@" 2>&1 | grep -v -E "^Godot Engine v|^$"
exit "${PIPESTATUS[0]}"
