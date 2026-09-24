#!/usr/bin/env bash
# rofi script mode: clipboard history from cliphist.  `rofi -show clip`.
#
#   Enter          copy the entry back to the clipboard
#   Shift+Delete   remove the entry from the history
#
# Rows show cliphist's preview text (images show a thumbnail); the raw "<id>\t<preview>" line rides
# along in ROFI_INFO so decode/delete get exactly the entry that was chosen.
set -u

# Image entries ("[[ binary data 389 KiB png 492x647 ]]") get a real thumbnail:
# decoded once with ImageMagick into a cache keyed by the cliphist id (ids are
# never reused for different content), then handed to rofi as the row icon.
THUMBS="${XDG_CACHE_HOME:-$HOME/.cache}/hypr-shell/clip-thumbs"
mkdir -p "$THUMBS"

thumb() { # id -> path of a 96px thumbnail, or nothing on failure
  local f="$THUMBS/$1.png"
  if [ ! -s "$f" ]; then
    printf '%s\t\n' "$1" | cliphist decode 2>/dev/null | magick - -thumbnail 96x96 "png:$f" 2>/dev/null || { rm -f "$f"; return 1; }
  fi
  printf '%s' "$f"
}

list() {
  printf '\0prompt\x1fClip\n\0message\x1fEnter copies  ·  Shift+Delete removes\n'
  cliphist list 2>/dev/null | head -300 | while IFS= read -r line; do
    id=${line%%$'\t'*}
    preview=${line#*$'\t'}
    # a raw tab inside a row would corrupt rofi's protocol; and cliphist
    # needs "<id><TAB>..." so only the id rides along (an earlier version
    # stuffed the whole line into ROFI_INFO with the tab turned into a
    # space, which made both decode and delete fail with "converting id")
    preview=${preview//$'\t'/ }
    if [[ $preview == "[[ binary data"* ]] && icon=$(thumb "$id"); then
      printf '%s\0icon\x1f%s\x1finfo\x1f%s\n' "$preview" "$icon" "$id"
    else
      printf '%s\0info\x1f%s\n' "$preview" "$id"
    fi
  done
}

case "${ROFI_RETV:-0}" in
  0) list ;;
  1) printf '%s\t\n' "${ROFI_INFO:-}" | cliphist decode | wl-copy ;;
  3) printf '%s\t\n' "${ROFI_INFO:-}" | cliphist delete; list ;;
esac
