#!/usr/bin/env bash
# Screen recording, one toggle: starts if idle, stops if running.
#
#   record.sh toggle area [audio]     drag a region with slurp
#   record.sh toggle screen [audio]   the focused monitor
#   record.sh stop                    stop if running (no-op otherwise)
#
# `audio` records what the speakers are playing (the default sink's monitor),
# never the microphone.
#
# State lives in $XDG_RUNTIME_DIR/screenrecord/{pid,start,file}; the bar's
# red dot and the Control Center row read the same files (bar/recordState.ts),
# so there is no second source of truth to drift.
set -uo pipefail

DIR="${XDG_VIDEOS_DIR:-$HOME/Videos}/ScreenRecords"
RT="${XDG_RUNTIME_DIR:-/tmp}/screenrecord"
mkdir -p "$DIR" "$RT"

running() {
  local pid
  pid=$(cat "$RT/pid" 2>/dev/null) || return 1
  [[ -n $pid && -r /proc/$pid/comm && $(cat "/proc/$pid/comm") == wf-recorder ]]
}

cleanup() { rm -f "$RT/pid" "$RT/start" "$RT/file"; }

stop() {
  if ! running; then cleanup; return 0; fi
  local pid file
  pid=$(cat "$RT/pid"); file=$(cat "$RT/file" 2>/dev/null)
  # SIGINT is how wf-recorder finalises the container; SIGKILL leaves an
  # unplayable file. Wait for it to finish writing before announcing.
  kill -INT "$pid"
  for _ in $(seq 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
  cleanup
  if [[ -s $file ]]; then
    notify-send -a "Screen recording" -i video-x-generic "Recording saved" "$(basename "$file")  ($(du -h "$file" | cut -f1))"
  else
    notify-send -a "Screen recording" -u critical "Recording failed" "No file was written"
  fi
}

start() {
  local mode=$1 audio=${2:-} args=() geo
  case $mode in
    area)
      geo=$(slurp -d) || exit 0            # Esc in slurp = cancel, not an error
      [[ -n $geo ]] || exit 0
      args+=(-g "$geo") ;;
    screen)
      args+=(-o "$(hyprctl monitors -j | jq -r '.[] | select(.focused) | .name')") ;;
    *) echo "mode must be area|screen" >&2; exit 1 ;;
  esac
  [[ $audio == audio ]] && args+=(--audio="$(pactl get-default-sink).monitor")

  local file="$DIR/screenrecord_$(date +%Y%m%d_%H%M%S).mp4"

  # Hardware H.264 first (VAAPI on the iGPU: no CPU spike); if that
  # process dies straight away, fall back to software x264.
  #
  # Run under an IDLE inhibitor. wf-recorder does not tell the system it is
  # busy, so a recording longer than the idle-lock timeout (5 min, with no
  # keyboard/mouse activity) would end with hypridle locking the screen and
  # the lock screen being what gets recorded. hypridle honours
  # `systemd-inhibit --what=idle` by default (ignore_systemd_inhibit = false);
  # the inhibitor lives exactly as long as wf-recorder does, so it can never
  # be left behind. `pgrep -x wf-recorder` below still finds the recorder
  # itself (systemd-inhibit only wraps it).
  launch() {
    setsid systemd-inhibit --what=idle --who="Screen recording" --why="Recording the screen" \
      wf-recorder "${args[@]}" "$@" -f "$file" >/dev/null 2>&1 &
  }
  launch -c h264_vaapi -d /dev/dri/renderD128
  sleep 1.2
  if ! pgrep -x wf-recorder >/dev/null; then
    launch -c libx264 -p preset=veryfast -p crf=23
    sleep 1
  fi

  if pid=$(pgrep -n -x wf-recorder); then
    echo "$pid" > "$RT/pid"; date +%s > "$RT/start"; echo "$file" > "$RT/file"
  else
    notify-send -a "Screen recording" -u critical "Recording failed to start" "wf-recorder exited"
    exit 1
  fi
}

case "${1:-}" in
  toggle) if running; then stop; else cleanup; start "${2:-area}" "${3:-}"; fi ;;
  stop)   stop ;;
  *)      echo "usage: $0 toggle area|screen [audio] | stop" >&2; exit 1 ;;
esac
