#!/bin/bash
# Double-click to play HustleLife on a Mac. Keep the window open while you play.
cd "$(dirname "$0")" || exit 1
# Finder does not load your shell setup, so look where Node usually lives
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
if ! command -v node >/dev/null 2>&1; then
  echo "HustleLife needs Node 22 or newer. Get the LTS from https://nodejs.org, then double-click this again."
  read -n 1 -s -r -p "Press any key to close."; exit 1
fi
node start.mjs "$@" || { echo; read -n 1 -s -r -p "Press any key to close."; }
