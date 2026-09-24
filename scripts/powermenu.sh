#!/usr/bin/env bash
# Power menu via rofi. Bound to SUPER+ESCAPE in conf/binds.lua.
set -euo pipefail

THEME="$HOME/.config/rofi/powermenu.rasi"

lock="  Lock"
suspend="  Suspend"
logout="  Log out"
reboot="  Reboot"
shutdown="  Shut down"

chosen=$(printf '%s\n' "$lock" "$suspend" "$logout" "$reboot" "$shutdown" \
  | rofi -dmenu -theme "$THEME" -mesg "$(uptime -p)" -p "power")

case "$chosen" in
  # No --grace anywhere: during the grace window hyprlock unlocks on any
  # input with no password at all. See the note in hyprlock.conf.
  "$lock")     hyprlock ;;
  "$suspend")  hyprlock & sleep 0.4; systemctl suspend ;;
  # `hyprctl dispatch exit` is the OLD hyprlang form — dead under this
  # Lua config the same way `dpms on` was (see hypridle.conf). The
  # working form, already used and verified in bar/SessionMenu.tsx:
  "$logout")   hyprctl dispatch 'hl.dsp.exit()' ;;
  "$reboot")   systemctl reboot ;;
  "$shutdown") systemctl poweroff ;;
  *)           exit 0 ;;
esac
