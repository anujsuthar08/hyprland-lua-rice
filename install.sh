#!/usr/bin/env bash
# One-shot setup for a fresh Arch machine: packages, then the config links.
#
#   ./install.sh                  DRY RUN: prints everything it would do
#   ./install.sh --apply          install packages + run deploy.sh --apply
#   ./install.sh --apply --with-optional     also the packages in packages/optional.txt
#   ./install.sh --apply --no-packages       skip pacman/AUR (only deploy + defaults)
#   ./install.sh --apply --no-deploy         only packages
#
# Idempotent: packages already installed are skipped, links already in place are
# left alone, and nothing existing is deleted (deploy.sh moves old config dirs to a
# timestamped backup). Needs sudo for pacman; an AUR helper (yay or paru) is used
# for AUR packages, and yay is bootstrapped from the AUR if neither is present.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPLY=0; OPTIONAL=0; PKGS=1; DEPLOY=1
for a in "$@"; do
  case "$a" in
    --apply) APPLY=1 ;;
    --with-optional) OPTIONAL=1 ;;
    --no-packages) PKGS=0 ;;
    --no-deploy) DEPLOY=0 ;;
    -h|--help) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $a (see --help)" >&2; exit 2 ;;
  esac
done

say()  { printf '%s\n' "$*"; }
step() { printf '\n── %s ─────────────────────────────────────────\n' "$*"; }
run()  { if [ $APPLY = 1 ]; then "$@"; else printf '    would run: %s\n' "$*"; fi; }
readlist() { sed -e 's/#.*//' -e 's/[[:space:]]//g' "$@" | grep -v '^$' || true; }

[ $APPLY = 1 ] && say "▶ APPLYING" || say "▶ DRY RUN (nothing will change) — re-run with --apply"

step "system check"
if ! command -v pacman >/dev/null; then say "This is not Arch (no pacman). Install the packages in packages/*.txt by hand, then run ./deploy.sh."; exit 1; fi
[ "$(id -u)" = 0 ] && { say "Run as your normal user, not root (sudo is used where needed; makepkg refuses root)."; exit 1; }
say "ok: pacman found, user $(id -un)"

if [ $PKGS = 1 ]; then
  step "official packages"
  mapfile -t want < <(readlist "$ROOT/packages/official.txt"; [ $OPTIONAL = 1 ] && readlist "$ROOT/packages/optional.txt")
  missing=(); for p in "${want[@]}"; do pacman -Qq "$p" >/dev/null 2>&1 || missing+=("$p"); done
  if [ ${#missing[@]} = 0 ]; then say "all ${#want[@]} already installed"
  else say "missing (${#missing[@]}): ${missing[*]}"; run sudo pacman -S --needed "${missing[@]}"; fi

  step "AUR packages"
  helper=""; for h in yay paru; do command -v $h >/dev/null && { helper=$h; break; }; done
  if [ -z "$helper" ]; then
    say "no AUR helper found; would bootstrap yay from the AUR (needs git, base-devel)"
    if [ $APPLY = 1 ]; then
      sudo pacman -S --needed git base-devel
      tmp=$(mktemp -d); git clone https://aur.archlinux.org/yay-bin.git "$tmp/yay-bin"
      (cd "$tmp/yay-bin" && makepkg -si)
      rm -rf "$tmp"; helper=yay
    else helper=yay; fi
  fi
  mapfile -t aur < <(readlist "$ROOT/packages/aur.txt")
  missing=(); for p in "${aur[@]}"; do pacman -Qq "$p" >/dev/null 2>&1 || missing+=("$p"); done
  if [ ${#missing[@]} = 0 ]; then say "all ${#aur[@]} already installed"
  else say "missing (${#missing[@]}): ${missing[*]}  (via $helper; git packages build from source, this takes a while)"; run "$helper" -S --needed "${missing[@]}"; fi
fi

step "machine-specific overrides"
if [ -f "$ROOT/conf/local.lua" ]; then say "conf/local.lua exists — leaving it alone"
else
  say "no conf/local.lua: monitors fall back to 'preferred, auto scale'. Copy the example and edit it for your hardware:"
  say "    cp conf/local.example.lua conf/local.lua"
fi

if [ $DEPLOY = 1 ]; then
  step "link the config into ~/.config"
  if [ $APPLY = 1 ]; then "$ROOT/deploy.sh" --apply; else "$ROOT/deploy.sh"; fi
fi

step "default wallpaper"
wp="$HOME/.config/wallpapers"
have=$(find -L "$wp" -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' \) -not -path '*/lockscreen/*' -print -quit 2>/dev/null || true)
if [ -n "$have" ]; then
  say "wallpapers already in $wp — leaving them alone"
else
  say "no wallpapers yet: copying the bundled default so the theme has something to start from"
  run mkdir -p "$wp/defaults"; run cp "$ROOT/assets/default-wallpaper.jpg" "$wp/defaults/default-wallpaper.jpg"
fi

step "kitty theming"
# matugen writes ~/.config/kitty/colors.conf on every wallpaper change (see
# matugen/config.toml's [templates.kitty]), but kitty only picks it up if
# kitty.conf has an `include colors.conf` line — and kitty.conf isn't ours
# to symlink or overwrite (deploy.sh only links hypr/ags/rofi; a fresh
# kitty.conf here is either the user's own long-standing config or pacman's
# untouched stock one). Idempotent: checked, appended, or created, never
# rewritten wholesale.
kcfg="$HOME/.config/kitty/kitty.conf"
if [ -f "$kcfg" ] && grep -qE '^[[:space:]]*include[[:space:]]+colors\.conf[[:space:]]*$' "$kcfg"; then
  say "kitty.conf already includes colors.conf — leaving it alone"
else
  [ -f "$kcfg" ] && say "appending the matugen include to existing kitty.conf" \
                  || say "no kitty.conf yet — creating one with just the matugen include"
  run mkdir -p "$HOME/.config/kitty"
  # Must be LAST in the file so it wins over any colour settings above it.
  run bash -c "cat >> '$kcfg' <<'KCONF'

# ── matugen ─────────────────────────────────────────────────────────
# colors.conf is GENERATED from the current wallpaper by
# ~/.config/hypr/matugen/config.toml. Must be last so it wins over the
# colour settings above. Regenerated on every wallpaper change; kitty
# reloads it via SIGUSR1 (matugen post_hook).
include colors.conf
KCONF"
fi

step "next steps"
cat <<TXT
  1. Add your own images to ~/.config/wallpapers/ and pick one with SUPER+SHIFT+W (this generates
     the colours for the shell, rofi, kitty, lock screen, GTK and Qt apps).
  2. Weather (optional): scripts/weather-city.py "<your city>"
  3. Log in to Hyprland, then run scripts/smoke-test.sh.
TXT
