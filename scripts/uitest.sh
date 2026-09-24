#!/usr/bin/env bash
# Drive the real pointer/keyboard through ydotool, for testing the shell.
#
#   uitest.sh move X Y | click X Y | rclick X Y | drag X1 Y1 X2 Y2
#   uitest.sh key ESC | shot NAME [x,y WxH]
#
# Coordinates are SCREEN pixels (1920x1080). Two non-obvious things this
# hides, both found the hard way:
#   * ydotool's absolute movement is 2x — asking for 100 lands on 200 —
#     so every coordinate is halved here (verified against
#     `hyprctl cursorpos`).
#   * ydotoold's socket is /run/user/1000/.ydotool_socket, not the
#     client's default /tmp/.ydotool_socket.
# Screenshots go to $UITEST_DIR (default /tmp/uitest).
export YDOTOOL_SOCKET="${YDOTOOL_SOCKET:-/run/user/$(id -u)/.ydotool_socket}"
OUT="${UITEST_DIR:-/tmp/uitest}"; mkdir -p "$OUT"
mv() { ydotool mousemove --absolute -x $(( $1 / 2 )) -y $(( $2 / 2 )); sleep 0.35; }
case "${1:-}" in
  move)   mv "$2" "$3" ;;
  click)  mv "$2" "$3"; ydotool click 0xC0; sleep 0.4 ;;
  rclick) mv "$2" "$3"; ydotool click 0xC1; sleep 0.4 ;;
  drag)   mv "$2" "$3"; ydotool click 0x40; sleep 0.2; mv "$4" "$5"; ydotool click 0x80; sleep 0.4 ;;
  key)    case "$2" in ESC) ydotool key 1:1 1:0 ;; *) echo "add a keycode for $2" >&2; exit 1 ;; esac ;;
  shot)   if [ -n "${3:-}" ]; then grim -g "$3" "$OUT/$2.png"; else grim "$OUT/$2.png"; fi; echo "$OUT/$2.png" ;;
  *)      sed -n '2,15p' "$0"; exit 1 ;;
esac
