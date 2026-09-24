#!/usr/bin/env bash
# Run a Hyprland config in a nested instance and show config-time output.
#
# IMPORTANT: the Lua config is evaluated BEFORE Hyprland redirects
# logging to /run/user/$UID/hypr/<sig>/hyprland.log, so all `hl.print`
# output and every config-time "Lua error" goes to STDOUT. Grepping the
# instance log file for them finds nothing. Capture stdout.
set -u
CFG="${1:?usage: probe.sh <config.lua> [seconds]}"
SECS="${2:-12}"
OUT=$(mktemp)

timeout "$SECS" Hyprland -c "$CFG" > "$OUT" 2>&1

sed -E 's/\x1b\[[0-9;]*m//g' "$OUT" \
  | grep -E 'Lua error|hl\.|PROBE|\[cfg\]' \
  | grep -viE 'xkbcomp|pixman|keysym|Virtual modifier'
rm -f "$OUT"
