#!/usr/bin/env bash
# Point qt5ct and qt6ct at the matugen colour scheme. Run as the post_hook of the
# [templates.qt6ct] entry, and safe to run any time (idempotent).
#
# qt6ct wants an ABSOLUTE color_scheme_path, so it cannot live in a tracked file;
# this writes the per-user qt*ct.conf instead. Only the three keys below are
# touched — anything else set through the qt6ct GUI is kept.
#   style=Fusion       : the built-in style that honours a custom palette
#   custom_palette=true: use the generated colours, not the style's own
set -euo pipefail

for app in qt5ct qt6ct; do
  dir="$HOME/.config/$app"
  conf="$dir/$app.conf"
  scheme="$dir/colors/matugen.conf"
  [ -f "$scheme" ] || continue
  mkdir -p "$dir"
  [ -f "$conf" ] || printf '[Appearance]\n' > "$conf"
  grep -q '^\[Appearance\]' "$conf" || printf '[Appearance]\n' >> "$conf"
  for kv in "style=Fusion" "custom_palette=true" "color_scheme_path=$scheme"; do
    key="${kv%%=*}"
    if grep -q "^$key=" "$conf"; then
      sed -i "s|^$key=.*|$kv|" "$conf"
    else
      sed -i "/^\[Appearance\]/a $kv" "$conf"
    fi
  done
done
