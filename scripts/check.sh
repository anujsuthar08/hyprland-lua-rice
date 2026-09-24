#!/usr/bin/env bash
# Full config check. Run after ANY config edit.
#
# Grepping stdout for "Lua error" is NOT enough — invalid colors and
# invalid window_rule matchers never appear there. They only surface in
# `hyprctl configerrors` (what the red on-screen overlay renders).
#
# The temp wrapper is written NEXT TO the config on purpose: Hyprland
# sets package.path from the directory of the -c file, so a wrapper in
# /tmp would make every require("conf.*") fail.
set -u
CFG="${1:-$(cd "$(dirname "$0")/.." && pwd)/hyprland.lua}"
DIR=$(cd "$(dirname "$CFG")" && pwd)
OUT=/tmp/hypr-configerrors.txt
BINDS=/tmp/hypr-binds.json
WRAP="$DIR/.check-$$.lua"
cleanup() { rm -f "$WRAP"; }
trap cleanup EXIT

cat > "$WRAP" <<LUA
dofile("$CFG")
hl.on("hyprland.start", function()
  hl.exec_cmd("sh -c 'sleep 3; hyprctl configerrors > $OUT 2>&1; hyprctl binds -j > $BINDS 2>&1'")
end)
LUA

rm -f "$OUT" "$BINDS"
timeout 16 Hyprland -c "$WRAP" >/tmp/hypr-check-stdout.log 2>&1

echo "── Lua errors (stdout) ──"
e=$(sed -E 's/\x1b\[[0-9;]*m//g' /tmp/hypr-check-stdout.log \
     | grep -i 'lua error' | sed -E 's/.*Lua error[^:]*: //' | sort -u)
[ -n "$e" ] && echo "$e" || echo "  none"

echo "── hyprctl configerrors ──"
if [ -s "$OUT" ] && grep -q "[^[:space:]]" "$OUT"; then
  sed "s|$DIR/|  |" "$OUT"
else
  echo "  none"
fi

# ── duplicate binds ───────────────────────────────────────────────────
# Binding the same (modmask, key) twice is NOT an error to Hyprland: it
# registers both and fires both on one press. No Lua error, no
# configerror. This is how SUPER+CTRL+H/L ended up being resize AND a
# workspace switch at the same time. The Lua API reports every bind as
# dispatcher "__lua", so the collision is only visible as a repeated
# (modmask, key, submap, release, mouse) tuple.
echo "── duplicate binds ──"
if [ -s "$BINDS" ] && command -v jq >/dev/null 2>&1; then
  # NOTE: delimiter must NOT be whitespace. `read` with IFS=$'\t' strips
  # a LEADING empty field, and .submap is empty for every top-level bind,
  # which shifted every column by one.
  # (key lower-cased: Hyprland treats "Tab" and "TAB" as the same key, so a bind spelled one way
  # silently doubles up with one spelled the other — found when Alt+Tab skipped every second window)
  dupes=$(jq -r '.[] | "\(.modmask)|\(.key | ascii_downcase)|\(.submap)|\(.release)"' "$BINDS" \
          | sort | uniq -d)
  if [ -n "$dupes" ]; then
    printf '%s\n' "$dupes" | while IFS='|' read -r mod key sm rel; do
      echo "  DUPLICATE  modmask=$mod key=$key${sm:+ submap=$sm}$([ "$rel" = true ] && echo ' release')"
    done
  else
    n=$(jq 'length' "$BINDS")
    echo "  none ($n binds registered)"
  fi
else
  echo "  (could not read $BINDS — jq missing or nested run failed)"
fi

# ── undescribed binds ─────────────────────────────────────────────────
# The keybind cheat sheet (widget/Cheatsheet.tsx) is generated from
# `hyprctl binds -j` and groups by each bind's description. A bind added
# with a plain hl.bind() has none, so it lands in an "Undescribed" group
# instead of its proper section. Every bind in conf/binds.lua goes through
#   bind(keys, "Group: what it does", dispatcher, opts?)
# (catch-all binds are exempt: they are mode-exit plumbing).
echo "── undescribed binds ──"
if [ -s "$BINDS" ] && command -v jq >/dev/null 2>&1; then
  missing=$(jq -r '.[] | select(.catch_all == false and .has_description == false)
                   | "\(.modmask)|\(.key)|\(.submap)"' "$BINDS")
  if [ -n "$missing" ]; then
    printf '%s\n' "$missing" | while IFS='|' read -r mod key sm; do
      echo "  UNDESCRIBED  modmask=$mod key=$key${sm:+ submap=$sm}  — use bind() with a description in conf/binds.lua"
    done
  else
    echo "  none (every bind is in the cheat sheet)"
  fi
fi
