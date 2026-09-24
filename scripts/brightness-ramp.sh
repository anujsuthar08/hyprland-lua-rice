#!/usr/bin/env bash
# Ramp the backlight up smoothly instead of snapping to full brightness the
# instant you touch the mouse/keyboard after an idle dim — the "flashbang"
# effect other rices (end-4/dots-hyprland, Noctalia) specifically call out
# and fix. Called from hypridle.conf's dim listener's `on-resume`.
#
# Deliberately does NOT use `brightnessctl -s`/`-r`: that pair's save file
# lives at an undocumented path ($XDG_RUNTIME_DIR/brightnessctl/<class>/<dev>,
# found by testing, not documented in --help or a man page) and only ever
# holds the value from the last `-s`, so a ramp reading it mid-transition
# would have nothing reliable to aim at. Store the pre-dim value ourselves
# instead — see the `on-timeout` line in hypridle.conf that writes STATE.
set -euo pipefail

STATE="$HOME/.cache/pre-dim-brightness"
LOCK="/tmp/brightness-ramp.lock"
STEPS=10
STEP_SLEEP=0.03   # 10 * 30ms = ~300ms total, the low end of what reads as a ramp not a stutter

# Nothing saved (e.g. hypridle just started, or the dim listener never
# fired) — nothing to ramp to, leave the backlight exactly as it is.
[ -f "$STATE" ] || exit 0
target="$(cat "$STATE")"
case "$target" in ''|*[!0-9]*) exit 0 ;; esac   # guard against a torn/empty read

# Non-blocking: if a ramp is already in flight (rapid repeated activity),
# let it keep running rather than starting a second one that fights it for
# the same backlight — both converge on the same target either way.
exec 9>"$LOCK"
flock -n 9 || exit 0

current="$(brightnessctl g)"
[ "$current" -lt "$target" ] || exit 0   # already at/above target, nothing to do

step=$(( (target - current) / STEPS ))
[ "$step" -gt 0 ] || step=1

for _ in $(seq 1 "$STEPS"); do
  current=$(( current + step ))
  [ "$current" -lt "$target" ] || { brightnessctl set "$target" >/dev/null; break; }
  brightnessctl set "$current" >/dev/null
  sleep "$STEP_SLEEP"
done
