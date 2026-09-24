#!/usr/bin/env bash
# One line for the lock screen: "♪ Artist — Title" while something is PLAYING, nothing at
# all otherwise (a paused player or no player leaves the line empty). Trimmed so a long
# title cannot run off the screen. hyprlock calls this every few seconds, so it stays
# tiny and never blocks: playerctl is given 1 s.
set -u
st=$(timeout 1 playerctl status 2>/dev/null) || exit 0
[ "$st" = "Playing" ] || exit 0
artist=$(timeout 1 playerctl metadata artist 2>/dev/null)
title=$(timeout 1 playerctl metadata title 2>/dev/null)
[ -n "$title" ] || exit 0
line="♪ ${artist:+$artist — }$title"
# markup-safe: hyprlock renders Pango markup, and titles love '&' and '<'
# (the replacements are QUOTED: bash 5.2 treats a bare & in a replacement as "the matched text")
line=${line//&/"&amp;"}; line=${line//</"&lt;"}; line=${line//>/"&gt;"}
if [ ${#line} -gt 56 ]; then line="${line:0:55}…"; fi
printf '%s\n' "$line"
