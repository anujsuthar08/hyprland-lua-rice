#!/usr/bin/env bash
# Screenshot helper: grimblast for capture, swappy for annotation.
#
#   screenshot.sh area|screen|window   # copy + save
#   screenshot.sh edit                 # capture area, open in swappy
set -euo pipefail

DIR="${XDG_PICTURES_DIR:-$HOME/Pictures}/screenshots"
mkdir -p "$DIR"
name="$DIR/$(date +%Y-%m-%d_%H-%M-%S).png"

case "${1:-area}" in
  edit)   grimblast save area - | swappy -f - ;;
  area)   grimblast --notify copysave area   "$name" ;;
  screen) grimblast --notify copysave screen "$name" ;;
  window) grimblast --notify copysave active "$name" ;;
  *)      echo "usage: $0 area|screen|window|edit" >&2; exit 1 ;;
esac
