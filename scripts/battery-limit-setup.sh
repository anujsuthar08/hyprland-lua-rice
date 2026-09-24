#!/usr/bin/env bash
# One-time, needs sudo: let your user change the battery charge limit.
#
#   scripts/battery-limit-setup.sh            show what it would do (changes nothing)
#   sudo scripts/battery-limit-setup.sh --apply
#
# The kernel exposes /sys/class/power_supply/BAT*/charge_control_end_threshold (ASUS,
# ThinkPad, Framework and others) but only root may write it, so the shell's "Limit
# charge to 80%" switch has nothing to write to. This installs one udev rule that makes
# that single file writable by the `wheel` group. It touches nothing else and grants
# nothing beyond "choose the charge limit". Remove it with --remove.
# (ASUS firmware keeps the value across reboots; the shell re-applies your choice at
# login anyway.)
set -euo pipefail

RULE=/etc/udev/rules.d/60-battery-charge-limit.rules
# no shell variables in the rule: udev would try to expand `$name` itself
read -r -d '' CONTENT <<'RULE_EOF' || true
# Written by hyprland-lua-rice scripts/battery-limit-setup.sh
ACTION=="add|change", SUBSYSTEM=="power_supply", ATTR{type}=="Battery", RUN+="/bin/sh -c 'chgrp wheel /sys%p/charge_control_end_threshold && chmod g+w /sys%p/charge_control_end_threshold'"
RULE_EOF

ls /sys/class/power_supply/BAT*/charge_control_end_threshold >/dev/null 2>&1 \
  || { echo "This machine's battery has no charge_control_end_threshold: nothing to set up."; exit 1; }

case "${1:-}" in
  --apply)
    [ "$(id -u)" = 0 ] || { echo "run with sudo: sudo $0 --apply"; exit 1; }
    printf '%s\n' "$CONTENT" > "$RULE"
    udevadm control --reload
    udevadm trigger --subsystem-match=power_supply --action=change
    echo "installed $RULE"
    ls -l /sys/class/power_supply/BAT*/charge_control_end_threshold ;;
  --remove)
    [ "$(id -u)" = 0 ] || { echo "run with sudo: sudo $0 --remove"; exit 1; }
    rm -f "$RULE"; udevadm control --reload
    echo "removed $RULE (permissions return to root-only at next boot)" ;;
  *)
    echo "Would write $RULE:"; echo; printf '%s\n' "$CONTENT"; echo
    echo "Current file:"; ls -l /sys/class/power_supply/BAT*/charge_control_end_threshold
    echo; echo "Run: sudo $0 --apply" ;;
esac
