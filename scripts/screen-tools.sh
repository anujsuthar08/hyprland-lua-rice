#!/usr/bin/env bash
# Small tools that work on a region of the screen (ideas from Noctalia's "Screen Toolkit").
#
#   screen-tools.sh qr      [FILE]   select a region, read the QR code / barcode in it, copy the text
#   screen-tools.sh palette [FILE]   select a region, extract its 6 main colours, copy them as hex
#
# With FILE the image is read from it instead of the screen (used for testing).
# A QR code is only ever COPIED and shown, never opened: a code on a web page or poster is
# untrusted input, and opening a link automatically is how QR phishing works.
# Needs: grim slurp zbar (zbarimg) imagemagick wl-clipboard libnotify
set -uo pipefail

say() { notify-send -a "Screen tools" ${3:+-i "$3"} "$1" "${2:-}" >/dev/null 2>&1; }
need() { for c in "$@"; do command -v "$c" >/dev/null || { say "Screen tools" "$c is not installed"; exit 1; }; done; }

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
img="$tmp/region.png"

grab() {  # grab [FILE] -> $img
  if [ -n "${1:-}" ]; then cp "$1" "$img"; return 0; fi
  need grim slurp
  local region
  region=$(slurp -b '#00000066' -c '#ffffffff' -w 2) || exit 0        # Escape = cancel, silently
  timeout 10 grim -g "$region" "$img" || { say "Capture failed" "could not read the screen"; exit 1; }
}

case "${1:-}" in
  qr)
    need zbarimg magick wl-copy
    grab "${2:-}"
    # zbar is fussy about small or low-contrast codes on screens: retry upscaled + greyscale
    out=$(zbarimg --raw -q "$img" 2>/dev/null)
    if [ -z "$out" ]; then
      magick "$img" -resize 300% -colorspace Gray -normalize "$tmp/big.png" 2>/dev/null
      out=$(zbarimg --raw -q "$tmp/big.png" 2>/dev/null)
    fi
    if [ -z "$out" ]; then say "No QR code found" "Nothing readable in that region."; exit 0; fi
    printf '%s' "$out" | wl-copy
    case "$out" in
      http://*|https://*) say "QR code: link (copied, not opened)" "$out" ;;
      *)                  say "QR code copied" "$out" ;;
    esac
    ;;
  palette)
    need magick wl-copy
    grab "${2:-}"
    # count pixels per colour after reducing to 6, most common first
    mapfile -t cols < <(magick "$img" -resize 160x160\! +dither -colors 6 -format %c histogram:info:- 2>/dev/null \
      | sed -n 's/^ *\([0-9]*\):.*#\([0-9A-Fa-f]\{6\}\).*/\1 #\2/p' | sort -rn | awk '{print tolower($2)}')
    [ ${#cols[@]} -gt 0 ] || { say "No colours found"; exit 0; }
    printf '%s\n' "${cols[@]}" | wl-copy
    sw="$tmp/swatch.png"; args=()
    for c in "${cols[@]}"; do args+=( \( -size 48x48 "xc:$c" \) ); done
    magick "${args[@]}" +append "$sw" 2>/dev/null
    keep="${XDG_CACHE_HOME:-$HOME/.cache}/hypr-shell"; mkdir -p "$keep"; cp "$sw" "$keep/palette-swatch.png"
    say "Palette copied" "${cols[*]}" "$keep/palette-swatch.png"
    ;;
  *) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
