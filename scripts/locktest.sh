#!/usr/bin/env bash
# Render hyprlock in a throwaway NESTED Hyprland and screenshot it, so the
# live session is never locked (you would need the password to get back).
#
#   locktest.sh [OUT.png] [hyprlock.conf]
#
# Do NOT type wrong passwords into it to preview the fail state: PAM counts
# real failures against the real account (faillock), regardless of nesting.
set -u
OUT="${1:-/tmp/locktest.png}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CONF="${2:-$ROOT/hyprlock.conf}"
DIR="$ROOT"
WRAP="$DIR/.locktest-$$.lua"
LOG=/tmp/locktest.log
trap 'rm -f "$WRAP"' EXIT

cat > "$WRAP" <<LUA
hl.config({ misc = { disable_hyprland_logo = true } })
hl.on("hyprland.start", function()
  hl.exec_cmd("sh -c 'hyprlock -c $CONF >$LOG 2>&1 & sleep 5; grim $OUT; sleep 0.3; pkill -x hyprlock; sleep 0.5; hyprctl dispatch \"hl.dsp.exit()\"'")
end)
LUA
rm -f "$OUT"
timeout 25 Hyprland -c "$WRAP" >/tmp/locktest-hypr.log 2>&1
[ -s "$OUT" ] && echo "$OUT" || { echo "no screenshot"; tail -5 /tmp/locktest-hypr.log; }
sed -E 's/\x1b\[[0-9;]*m//g' "$LOG" 2>/dev/null | grep -i -E "error|does not exist|invalid|fail" | head -5
