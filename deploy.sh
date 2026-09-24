#!/usr/bin/env bash
#
# Deploy the new setup into ~/.config by symlink.
#
#   ./deploy.sh            # DRY RUN — prints what it would do, changes nothing
#   ./deploy.sh --apply    # actually do it
#   ./deploy.sh --revert   # restore the most recent backup
#
# Symlinks (not copies) so the clone stays the single source of truth
# and matugen's generated files land back in the repo.
#
#   ~/.config/hypr  -> <this repo>
#   ~/.config/ags   -> <this repo>/ags
#   ~/.config/rofi  -> <this repo>/rofi
#
# ⚠️ ~/.config/hypr currently holds the live archeclipse setup. It is
#    MOVED to a timestamped backup, never deleted.
#
set -euo pipefail

# The repo can be cloned anywhere; everything is linked from wherever this script lives.
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STAMP=$(date +%Y%m%d-%H%M%S)
MODE="${1:---dry-run}"

declare -A LINKS=(
  ["$HOME/.config/hypr"]="$SRC"
  ["$HOME/.config/ags"]="$SRC/ags"
  ["$HOME/.config/rofi"]="$SRC/rofi"
)

say() { printf '%s\n' "$*"; }
run() { if [ "$MODE" = "--apply" ]; then eval "$@"; else say "    would: $*"; fi; }

case "$MODE" in
  --revert)
    latest=$(find "$HOME/.config" -maxdepth 1 -name 'hypr.bak-*' | sort | tail -1)
    [ -z "$latest" ] && { say "no backup found"; exit 1; }
    say "restoring $latest -> ~/.config/hypr"
    [ -L "$HOME/.config/hypr" ] && rm "$HOME/.config/hypr"
    mv "$latest" "$HOME/.config/hypr"
    for d in ags rofi; do
      b=$(find "$HOME/.config" -maxdepth 1 -name "$d.bak-*" | sort | tail -1)
      [ -L "$HOME/.config/$d" ] && rm "$HOME/.config/$d"
      [ -n "$b" ] && mv "$b" "$HOME/.config/$d"
    done
    say "done — restart the session to pick it up"
    exit 0
    ;;
  --apply)  say "▶ APPLYING" ;;
  *)        say "▶ DRY RUN (nothing will change) — re-run with --apply"; MODE="--dry-run" ;;
esac
say

# preflight: never deploy a config that doesn't load
say "── preflight ─────────────────────────────────────────"
if [ "$MODE" = "--apply" ]; then
  out=$("$SRC/scripts/check.sh" 2>&1 || true)
  if echo "$out" | grep -qiE '^\s+[^ ].*(error|unknown|invalid)'; then
    say "$out"
    say
    say "✖ config has errors — refusing to deploy. Fix them first."
    exit 1
  fi
  say "  config check passed"
else
  say "  (skipped in dry run — run scripts/check.sh yourself)"
fi
say

say "── links ─────────────────────────────────────────────"
for dst in "${!LINKS[@]}"; do
  src="${LINKS[$dst]}"
  name=$(basename "$dst")

  if [ -L "$dst" ]; then
    cur=$(readlink -f "$dst")
    if [ "$cur" = "$(readlink -f "$src")" ]; then
      say "  ✓ $dst already links to $src"
      continue
    fi
    say "  ~ $dst is a symlink to $cur — replacing"
    run "rm '$dst'"
  elif [ -e "$dst" ]; then
    say "  ! $dst exists — backing up to $dst.bak-$STAMP"
    run "mv '$dst' '$dst.bak-$STAMP'"
  fi

  say "  + $dst -> $src"
  run "ln -s '$src' '$dst'"
done
say

say "── after applying ────────────────────────────────────"
say "  1. put at least one image in ~/.config/wallpapers/ "
say "  2. matugen --config ~/.config/hypr/matugen/config.toml image <img>"
say "  3. log out and back in (or start a nested instance to sanity check)"
say "  revert with: ./deploy.sh --revert"
