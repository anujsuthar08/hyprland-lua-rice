#!/usr/bin/env bash
# Track the exact package versions this desktop is known to work with.
#
#   pkg-versions.sh            write ../packages.lock from what is installed now
#   pkg-versions.sh --check    compare installed vs packages.lock (run after `yay -Syu`)
#   pkg-versions.sh --backup   copy the built AUR packages of the LOCKED versions
#                              to ~/.local/share/hypr-shell/pkg-backup (+ sha256sums)
#
# Why: the shell runs on aylurs-gtk-shell-git and ~19 libastal-*-git packages —
# AUR git snapshots that move constantly. A routine update can break the bar
# overnight, and yay's cache (where the working builds live) is one `yay -Sc`
# from gone. The lock says what worked; the backup lets you go back to it:
#
#   sudo pacman -U ~/.local/share/hypr-shell/pkg-backup/<package>.pkg.tar.zst
#
# Roll back only what --check reports as changed, then `systemctl --user restart
# hypr-shell`.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCK="$ROOT/packages.lock"
BACKUP="${PKG_BACKUP_DIR:-$HOME/.local/share/hypr-shell/pkg-backup}"

# The package lists live in packages/*.txt (one name per line, `#` comments) and are the
# single source shared with install.sh.
readlist() { sed -e 's/#.*//' -e 's/[[:space:]]//g' "$@" | grep -v '^$'; }
mapfile -t OFFICIAL < <(readlist "$ROOT/packages/official.txt" "$ROOT/packages/optional.txt" | sort -u)
OPTIONAL=$(readlist "$ROOT/packages/optional.txt")
mapfile -t AUR < <(readlist "$ROOT/packages/aur.txt")

# every installed libastal*-git library INCLUDING the bare core `libastal-git`
# (an earlier pattern, libastal-.*-git, silently missed it)
mapfile -t ASTAL < <(pacman -Qmq 2>/dev/null | grep -E '^libastal(-.+)?-git$' | grep -v -- '-debug$' | sort)
AURALL=("${AUR[@]}" "${ASTAL[@]}")

ver() { pacman -Q "$1" 2>/dev/null | awk '{print $2}'; }

current_lines() {
  for p in "${OFFICIAL[@]}"; do
    v=$(ver "$p")
    if [ -n "$v" ]; then echo "$p $v repo"
    elif grep -qx "$p" <<<"$OPTIONAL"; then :   # optional and not installed: not an error
    else echo "$p MISSING repo"; fi
  done
  for p in "${AURALL[@]}"; do v=$(ver "$p"); [ -n "$v" ] && echo "$p $v aur" || echo "$p MISSING aur"; done
}

case "${1:-}" in
  "")
    { echo "# Known-good package versions for this desktop (see scripts/pkg-versions.sh)."
      echo "# generated $(date -Iseconds); Hyprland $(ver hyprland); kernel $(uname -r)"
      echo "# name version source"
      current_lines | sort -k3,3 -k1,1
    } > "$LOCK"
    grep -c ' MISSING ' "$LOCK" | sed 's/^/packages MISSING (not installed): /'
    echo "wrote $LOCK ($(grep -vc '^#' "$LOCK") packages)"
    ;;
  --check)
    [ -f "$LOCK" ] || { echo "no $LOCK — run without arguments first"; exit 2; }
    drift=0
    while read -r name lockv src; do
      case "$name" in \#*|"") continue;; esac
      now=$(ver "$name"); now=${now:-MISSING}
      if [ "$now" != "$lockv" ]; then
        printf 'CHANGED  %-32s locked %-26s now %-26s (%s)\n' "$name" "$lockv" "$now" "$src"; drift=1
      fi
    done < "$LOCK"
    # installed AUR libraries that the lock does not know about
    for p in "${ASTAL[@]}"; do grep -q "^$p " "$LOCK" || { echo "NEW      $p (installed, not in the lock)"; drift=1; }; done
    [ $drift = 0 ] && echo "no drift: every locked package is at its locked version" || echo "drift found — if the shell misbehaves, roll back the CHANGED aur entries (see header)"
    exit $drift
    ;;
  --backup)
    [ -f "$LOCK" ] || { echo "no $LOCK — run without arguments first"; exit 2; }
    mkdir -p "$BACKUP"; n=0; missing=0
    while read -r name lockv src; do
      [ "$src" = aur ] || continue
      f=$(find "$HOME/.cache/yay" -maxdepth 2 -name "$name-$lockv-*.pkg.tar.*" ! -name '*.sig' 2>/dev/null | head -1)
      if [ -n "$f" ]; then cp -n "$f" "$BACKUP/" && n=$((n+1)); else echo "  no built file cached for $name $lockv"; missing=$((missing+1)); fi
    done < <(grep -v '^#' "$LOCK")
    ( cd "$BACKUP" && sha256sum ./*.pkg.tar.* > SHA256SUMS )
    echo "backed up $n package file(s) to $BACKUP ($(du -sh "$BACKUP" | cut -f1)); $missing without a cached build"
    ;;
  *) sed -n '2,16p' "$0"; exit 2;;
esac
