#!/usr/bin/env bash
#
# Set the wallpaper AND re-theme the whole desktop from it.
#
#   wallpaper.sh                        pick via rofi (SFW only)
#   wallpaper.sh --all                  include the nsfw folders in the picker
#   wallpaper.sh /path/to/file          use a specific image or video
#   wallpaper.sh --restore              re-apply the last choice (for autostart)
#   wallpaper.sh --set <target> <file>  set one target: desktop|lockscreen|sddm
#   wallpaper.sh --random [target]      random wallpaper from the whole collection
#
# The AGS wallpaper switcher (SUPER+SHIFT+W) drives --set / --random;
# the rofi picker above is the no-GUI fallback and still works.
#
# Handles BOTH kinds in the existing collection:
#   * still images  -> awww
#   * video (mp4/webm/gif) -> mpvpaper, with a frame extracted by ffmpeg
#     so matugen still has something to pull colours from
#
# matugen renders every template and each post_hook reloads the app that
# consumes it, so one pick re-themes hyprland + bar + rofi + kitty + lock.
#
set -euo pipefail

# Where the wallpaper collection lives (override with WALLPAPER_DIR). This used to go
# through a repo symlink (~/.config/hypr/wallpapers -> repo/wallpapers -> here), which
# only existed on one machine; the AGS switcher already read this directory directly.
ROOT="${WALLPAPER_DIR:-$HOME/.config/wallpapers}"
CFG="$HOME/.config/hypr/matugen/config.toml"
STATE="$HOME/.cache/current-wallpaper"
FRAME="$HOME/.cache/wallpaper-frame.png"
ROFI_THEME="$HOME/.config/rofi/theme.rasi"

# Which wallpaper is currently applied to each target. The switcher reads
# these back (get-wallpapers.py --current) to show what is set where.
STATE_DIR="$HOME/.cache/wallpaper-state"

# lockscreen: hyprlock.conf points its background at this file
LOCK_DEST="$HOME/.config/wallpapers/lockscreen/current.jpg"
# sddm: sugar-candy's theme.conf has background="current_wallpaper.jpg",
# resolved relative to the theme root. The theme dir is owned by the
# user on this box, so this needs no sudo — checked before writing.
SDDM_DEST="/usr/share/sddm/themes/sugar-candy/current_wallpaper.jpg"

IMG_EXT='.*\.\(png\|jpg\|jpeg\|webp\)'
VID_EXT='.*\.\(mp4\|webm\|gif\)'

die() { notify-send -u critical "wallpaper" "$*" 2>/dev/null || true; echo "$*" >&2; exit 1; }

note() { notify-send -u low "wallpaper" "$*" 2>/dev/null || true; }

remember() {  # remember <target> <file>
  # Resolve symlinks before storing: the same wallpaper can reach this script under
  # different paths depending on the caller (a symlinked collection, a link inside it).
  # get-wallpapers.py --list emits the real path; storing a symlinked one would stop the
  # switcher from ever matching a thumbnail to "currently set".
  mkdir -p "$STATE_DIR"
  printf '%s\n' "$(realpath -m "$2")" > "$STATE_DIR/$1"
}

pick() {
  local include_nsfw="$1" prune=()
  [ "$include_nsfw" = "no" ] && prune=( -path '*nsfw*' -prune -o )

  # show paths relative to ROOT — the real filenames are unreadable hashes
  find -L "$ROOT" "${prune[@]}" \
       -type f \( -iregex "$IMG_EXT" -o -iregex "$VID_EXT" \) -print 2>/dev/null \
    | sed "s|^$ROOT/||" \
    | sort \
    | rofi -dmenu -i -p "wallpaper" -theme "$ROFI_THEME"
}

# Render a still JPEG of any wallpaper into $2. Videos get a frame pulled
# out; stills get converted, because the lockscreen and SDDM targets are
# both fixed-format single files and the collection is a mix of png/webp/mp4.
still_of() {
  local src="$1" dest="$2"
  mkdir -p "$(dirname "$dest")"
  case "${src,,}" in
    *.mp4|*.webm|*.mkv|*.mov)
      ffmpeg -y -loglevel error -i "$src" -vf "thumbnail" -frames:v 1 "$dest" 2>/dev/null \
        || die "could not extract a frame from $(basename "$src")"
      ;;
    *.gif)
      magick "${src}[0]" -quality 92 -strip "$dest" || die "could not convert $(basename "$src")"
      ;;
    *)
      magick "$src" -quality 92 -strip "$dest" || die "could not convert $(basename "$src")"
      ;;
  esac
}

apply_desktop() {
  local file="$1" source_img="$1"

  case "${file,,}" in
    *.mp4|*.webm|*.gif)
      # animated: mpvpaper drives the wallpaper, and matugen reads a
      # still frame grabbed one second in
      pkill -x awww-daemon 2>/dev/null || true
      ffmpeg -y -loglevel error -ss 00:00:01 -i "$file" -frames:v 1 "$FRAME" 2>/dev/null \
        || ffmpeg -y -loglevel error -i "$file" -frames:v 1 "$FRAME" 2>/dev/null \
        || die "could not extract a frame from $(basename "$file")"
      source_img="$FRAME"

      pkill -x mpvpaper 2>/dev/null || true
      mpvpaper -o "no-audio --loop --fs --panscan=1.0" '*' "$file" &
      disown
      ;;
    *)
      # still image: awww owns it, stop any running video wallpaper
      pkill -x mpvpaper 2>/dev/null || true
      pgrep -x awww-daemon >/dev/null 2>&1 || { awww-daemon & disown; sleep 0.5; }
      awww img "$file" --transition-type grow --transition-fps 144
      ;;
  esac

  # Render every template from the (still) source image.
  #
  # --prefer is REQUIRED: matugen 4 aborts with "Multiple source colors
  # found, no preference was inputted, and a terminal was not detected"
  # when it can't ask — which is always, since this runs from a keybind.
  # -m dark because the whole rice is dark.
  matugen --config "$CFG" --prefer saturation -m dark image "$source_img"

  printf '%s\n' "$file" > "$STATE"
  remember desktop "$file"
}

apply_lockscreen() {
  still_of "$1" "$LOCK_DEST"
  remember lockscreen "$1"
}

apply_sddm() {
  [ -w "$(dirname "$SDDM_DEST")" ] || [ -w "$SDDM_DEST" ] \
    || die "cannot write $SDDM_DEST — the sddm theme dir is not writable by you"
  still_of "$1" "$SDDM_DEST"
  remember sddm "$1"
}

apply_target() {  # apply_target <target> <file>
  local target="$1" file="$2"
  [ -f "$file" ] || die "not a file: $file"
  case "$target" in
    desktop)    apply_desktop    "$file" ;;
    lockscreen) apply_lockscreen "$file" ;;
    sddm)       apply_sddm       "$file" ;;
    *)          die "unknown target: $target (want desktop|lockscreen|sddm)" ;;
  esac
}

# Random picks never come from an nsfw folder: this runs from a keybind (and the
# slideshow) with people possibly looking at the screen. Only the explicit --nsfw picker
# lists those.
random_wallpaper() {
  find -L "$ROOT" -type f \( -iregex "$IMG_EXT" -o -iregex "$VID_EXT" \) \
       -not -path '*/lockscreen/*' -not -ipath '*nsfw*' -print 2>/dev/null | shuf -n1
}

# ── slideshow ────────────────────────────────────────────────────────────────
# Rotates the desktop wallpaper every N seconds (KDE-style: shuffle, no repeats until the
# pool is used up, fixed interval). Stills only — a video wallpaper means killing awww
# for mpvpaper, far too heavy to do every few minutes. Never nsfw. Skipped while the
# screen is locked. systemd does the waiting (transient user timer `hypr-slideshow`),
# so nothing keeps running here; the interval is remembered in SLIDE_STATE so the shell
# and a fresh login can re-arm it (`--slideshow resume`, called from autostart).
SLIDE_STATE="$HOME/.local/state/hypr-shell/slideshow"       # seconds; absent = off
SLIDE_SEEN="$HOME/.local/state/hypr-shell/slideshow-seen"   # already shown this round
SLIDE_UNIT=hypr-slideshow

slideshow_arm() {  # slideshow_arm <seconds>
  systemctl --user stop "$SLIDE_UNIT.timer" "$SLIDE_UNIT.service" 2>/dev/null || true
  systemd-run --user --unit="$SLIDE_UNIT" --collect --quiet \
    ${WALLPAPER_DIR:+--setenv=WALLPAPER_DIR="$WALLPAPER_DIR"} \
    --on-active="$1" --on-unit-active="$1" \
    "$(readlink -f "${BASH_SOURCE[0]}")" --slideshow next
}

slideshow_next() {
  pgrep -x hyprlock >/dev/null && return 0
  local pool seen f n
  pool=$(find -L "$ROOT" -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.webp' \) \
           -not -path '*/lockscreen/*' -not -ipath '*nsfw*' 2>/dev/null | sort)
  [ -n "$pool" ] || return 0
  mkdir -p "$(dirname "$SLIDE_SEEN")"; touch "$SLIDE_SEEN"
  # unseen = pool minus seen; when everything has been shown, start a new round
  f=$(comm -23 <(printf '%s\n' "$pool") <(sort "$SLIDE_SEEN") | shuf -n1)
  if [ -z "$f" ]; then
    : > "$SLIDE_SEEN"
    f=$(printf '%s\n' "$pool" | grep -vxF "$(cat "$STATE" 2>/dev/null)" | shuf -n1)
    [ -n "$f" ] || f=$(printf '%s\n' "$pool" | shuf -n1)
  fi
  printf '%s\n' "$f" >> "$SLIDE_SEEN"
  apply_desktop "$f"
}

slideshow() {
  case "${1:-status}" in
    on)     n="${2:-1800}"; [[ $n =~ ^[0-9]+$ && $n -ge 30 ]] || die "interval must be at least 30 seconds"
            mkdir -p "$(dirname "$SLIDE_STATE")"; printf '%s\n' "$n" > "$SLIDE_STATE"; slideshow_arm "$n" ;;
    off)    rm -f "$SLIDE_STATE"; systemctl --user stop "$SLIDE_UNIT.timer" "$SLIDE_UNIT.service" 2>/dev/null || true ;;
    resume) [ -s "$SLIDE_STATE" ] && slideshow_arm "$(cat "$SLIDE_STATE")" ;;
    next)   slideshow_next ;;
    cycle)  # off -> 15 min -> 1 h -> off (one key / one tile)
            case "$(cat "$SLIDE_STATE" 2>/dev/null)" in
              "")   slideshow on 900 ;;
              900)  slideshow on 3600 ;;
              *)    slideshow off ;;
            esac ;;
    status) if [ -s "$SLIDE_STATE" ]; then n=$(cat "$SLIDE_STATE"); [ "$n" -ge 60 ] && echo "on, every $(( n / 60 )) min" || echo "on, every ${n} s"; else echo off; fi ;;
    *)      die "usage: wallpaper.sh --slideshow on [seconds]|off|next|cycle|resume|status" ;;
  esac
}

# First boot has no saved state: fall back to the wallpaper that ships with the repo
# (generated by scripts/gen-default-wallpaper.py, so it has no licence attached), so the
# desktop never comes up bare.
DEFAULT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/assets/default-wallpaper.jpg"

case "${1:-}" in
  --restore)
    f=""
    [ -s "$STATE" ] && f=$(cat "$STATE")
    [ -n "$f" ] && [ -f "$f" ] || f="$DEFAULT"
    [ -f "$f" ] || { echo "no wallpaper to restore" >&2; exit 0; }
    apply_desktop "$f"
    ;;
  --set)
    [ $# -ge 3 ] || die "usage: wallpaper.sh --set <desktop|lockscreen|sddm> <file>"
    apply_target "$2" "$3"
    ;;
  --slideshow)
    slideshow "${2:-status}" "${3:-}"
    ;;
  --random)
    f=$(random_wallpaper)
    [ -n "$f" ] || die "no wallpapers found under $ROOT"
    apply_target "${2:-desktop}" "$f"
    note "random: $(basename "$f")"
    ;;
  --all|--nsfw)
    sel=$(pick yes) || exit 0
    [ -z "$sel" ] && exit 0
    apply_desktop "$ROOT/$sel"
    ;;
  "")
    sel=$(pick no) || exit 0
    [ -z "$sel" ] && exit 0
    apply_desktop "$ROOT/$sel"
    ;;
  *)
    [ -f "$1" ] || die "not a file: $1"
    apply_desktop "$1"
    ;;
esac
