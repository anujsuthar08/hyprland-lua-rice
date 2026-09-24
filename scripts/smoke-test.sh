#!/usr/bin/env bash
# One-command health check for the whole desktop. Safe to run any time:
# it reads state only — no key/mouse input, no display changes, nothing is
# started, stopped or written (except --full, which runs check.sh's nested
# Hyprland for ~16 s).
#
#   smoke-test.sh          quick checks against the RUNNING session (a few seconds)
#   smoke-test.sh --full   also run check.sh (nested Hyprland: Lua errors, configerrors,
#                          duplicate and undescribed binds)
#
# PASS / WARN / FAIL per check; exit 1 if anything FAILED (warnings do not fail).
# Run it after editing the config, after `yay -Syu`, or after a login.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FULL=0; [ "${1:-}" = "--full" ] && FULL=1
pass=0; warn=0; fail=0

if [ -t 1 ]; then G=$'\e[32m'; Y=$'\e[33m'; R=$'\e[31m'; D=$'\e[2m'; Z=$'\e[0m'; else G=; Y=; R=; D=; Z=; fi
ok()   { printf '  %sPASS%s  %s\n' "$G" "$Z" "$1"; pass=$((pass+1)); }
wn()   { printf '  %sWARN%s  %s\n' "$Y" "$Z" "$1"; warn=$((warn+1)); }
bad()  { printf '  %sFAIL%s  %s\n' "$R" "$Z" "$1"; fail=$((fail+1)); }
sec()  { printf '\n%s%s%s\n' "$D" "$1" "$Z"; }

# ── compositor ────────────────────────────────────────────────────────────
sec "compositor"
if hyprctl version >/dev/null 2>&1; then ok "hyprctl answers ($(hyprctl version | head -1 | awk '{print $1, $2}'))"; else bad "hyprctl does not answer — no Hyprland session in this shell?"; fi
dpms=$(hyprctl monitors -j 2>/dev/null | jq -r '[.[]|.dpmsStatus]|all' 2>/dev/null)
[ "$dpms" = true ] && ok "all displays are on (DPMS)" || bad "a display is OFF (dpmsStatus false) — restore: hyprctl dispatch 'hl.dsp.dpms({ action = \"on\" })'"
pgrep -x hyprlock >/dev/null && wn "the session is locked right now" || ok "session is not locked"
errs=$(hyprctl configerrors 2>/dev/null | grep -c '[^[:space:]]')
[ "$errs" = 0 ] && ok "no config errors (hyprctl configerrors)" || bad "hyprctl configerrors reports $errs line(s)"

# ── binds (from the live session — no nested instance needed) ──────────────
sec "keybinds"
bj=$(hyprctl binds -j 2>/dev/null)
n=$(echo "$bj" | jq 'length' 2>/dev/null)
und=$(echo "$bj" | jq '[.[]|select(.catch_all==false and .has_description==false)]|length' 2>/dev/null)
dup=$(echo "$bj" | jq -r '.[]|"\(.modmask)|\(.key|ascii_downcase)|\(.submap)|\(.release)"' 2>/dev/null | sort | uniq -d | wc -l)
[ "${n:-0}" -gt 0 ] && ok "$n binds registered" || bad "no binds registered"
[ "${dup:-1}" = 0 ] && ok "no duplicate binds" || bad "$dup duplicate bind(s) — one press fires both"
[ "${und:-1}" = 0 ] && ok "every bind has a description (cheat sheet complete)" || wn "$und bind(s) without a description — use bind() in conf/binds.lua"

# ── options ───────────────────────────────────────────────────────────────
sec "options"
if out=$("$ROOT/scripts/audit-options.py" 2>&1); then ok "$(echo "$out" | head -1)"; else bad "option audit: $(echo "$out" | head -3 | tr '\n' ' ')"; fi

# ── services and daemons ───────────────────────────────────────────────────
sec "services"
for u in hypr-shell hypridle; do
  st=$(systemctl --user is-active "$u" 2>&1)
  [ "$st" = active ] && ok "$u.service is active ($(systemctl --user show -p NRestarts --value "$u") restart(s))" || bad "$u.service is $st"
done
[ "$(systemctl --user is-active hyprpolkitagent 2>&1)" = active ] && ok "polkit agent is active" || wn "hyprpolkitagent is not active (auth prompts will not appear)"
ags list 2>/dev/null | grep -qx shell && ok "AGS instance 'shell' is running" || bad "AGS instance 'shell' is not running"
bars=$(hyprctl layers -j 2>/dev/null | jq '[..|objects|select(.namespace?=="bar")]|length' 2>/dev/null)
[ "${bars:-0}" -ge 1 ] && ok "bar layer is on screen ($bars)" || bad "no bar layer on screen"
for p in hyprsunset wl-clip-persist hyprexpose awww-daemon; do
  [ "$(pgrep -x "$p" | wc -l)" -ge 1 ] && ok "$p is running" || bad "$p is not running"
done
w=$(ps -C wl-paste --no-headers 2>/dev/null | wc -l)
[ "$w" = 2 ] && ok "both clipboard-history watchers are running" || bad "expected 2 wl-paste watchers, found $w (clipboard history)"
[ "$(pgrep -x hypridle | wc -l)" = 1 ] && ok "exactly one hypridle process" || wn "$(pgrep -x hypridle | wc -l) hypridle processes (expected 1: a hand-started copy is unsupervised)"

# ── launcher modes ─────────────────────────────────────────────────────────
sec "launcher modes (first call must print rows, or rofi quits)"
for m in calc clip emoji note timer shots ask; do
  f=$(ls "$ROOT"/scripts/rofi-"$m".* 2>/dev/null | head -1)
  if [ -z "$f" ]; then bad "rofi-$m script is missing"; continue; fi
  rows=$(ROFI_RETV=0 timeout 20 "$f" 2>/dev/null | grep -c .)
  [ "${rows:-0}" -ge 1 ] && ok "$m: $rows line(s) on first call" || bad "$m prints nothing on first call — rofi would quit immediately"
done
n=$(ROFI_RETV=0 timeout 20 "$ROOT/scripts/rofi-emoji.py" 2>/dev/null | grep -c $'\x1finfo\x1f')
[ "${n:-0}" -gt 1500 ] && ok "emoji list has $n entries" || bad "emoji list has only ${n:-0} entries (expected ~1900; did the cache break?)"

# ── packages ────────────────────────────────────────────────────────────────
sec "packages"
if [ -f "$ROOT/packages.lock" ]; then
  if out=$("$ROOT/scripts/pkg-versions.sh" --check 2>&1); then ok "installed versions match packages.lock"; else wn "package drift since the lock — $(echo "$out" | grep -c '^CHANGED') changed (run scripts/pkg-versions.sh --check)"; fi
else wn "no packages.lock"; fi

# ── data / logs ─────────────────────────────────────────────────────────────
sec "data and logs"
if [ -f "$HOME/.local/state/hypr-shell/weather.json" ]; then
  c="$HOME/.local/state/hypr-shell/weather-cache.json"
  if [ -f "$c" ]; then age=$(( $(date +%s) - $(stat -c %Y "$c") )); [ "$age" -lt 3600 ] && ok "weather cache is fresh (${age}s old)" || wn "weather cache is $((age/60)) min old (offline, or the API is failing)"; else wn "weather location set but no data cached yet"; fi
else ok "weather not configured (skipped)"; fi
since=$(systemctl --user show -p ActiveEnterTimestamp --value hypr-shell 2>/dev/null)
noise=$(journalctl --user -u hypr-shell ${since:+--since "$since"} --no-pager 2>/dev/null | grep -v -E "Theme parser|Starting|Started|Stopp|Consumed|Deactivated|Scheduled restart|^-- " | grep -i -E "error|critical|TypeError|ReferenceError|segmentation" || true)
if [ -z "$noise" ]; then ok "no errors in the shell journal since it last started"; else wn "$(echo "$noise" | wc -l) error line(s) in the shell journal since it last started; latest: $(echo "$noise" | tail -1 | cut -c1-100)"; fi

# ── repo ────────────────────────────────────────────────────────────────────
sec "repository"
if git -C "$ROOT" rev-parse >/dev/null 2>&1; then
  dirty=$(git -C "$ROOT" status --short | wc -l)
  [ "$dirty" = 0 ] && ok "working tree is clean" || wn "$dirty uncommitted file(s)"
  ahead=$(git -C "$ROOT" rev-list --count '@{u}..HEAD' 2>/dev/null || echo "?")
  [ "$ahead" = 0 ] && ok "nothing unpushed" || wn "$ahead commit(s) not pushed"
fi

# ── full: the nested-instance config check ──────────────────────────────────
if [ $FULL = 1 ]; then
  sec "full config check (nested Hyprland, ~16 s)"
  out=$("$ROOT/scripts/check.sh" 2>&1)
  if echo "$out" | grep -qE '^\s+[^ ].*(UNDESCRIBED|DUPLICATE|Lua error|error)' && ! echo "$out" | grep -qE '^\s+none'; then bad "check.sh reported problems:"; echo "$out" | sed 's/^/        /'; else ok "check.sh: $(echo "$out" | grep -c '^\s*none') sections clean"; fi
fi

printf '\n%s%d passed%s, %s%d warning(s)%s, %s%d failed%s\n' "$G" "$pass" "$Z" "$Y" "$warn" "$Z" "$R" "$fail" "$Z"
[ "$fail" = 0 ]
