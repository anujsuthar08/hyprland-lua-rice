import { exec } from "ags/process"
import GLib from "gi://GLib"

// A tiny compiled C loop, not a JS poll, for the same reason the old
// rice did it this way: sampling /proc/net/dev and doing the rate math
// in a subprocess that sleeps 3s between reads is near-zero CPU, and it
// can keep a running per-day total across AGS restarts by reading its
// own log file back in on startup — a JS-side poll would lose that the
// moment the shell restarts.
//
// Built into /tmp/ags-<user>/, not ~/.config/ags/ — that directory is a
// symlink into this repo (see deploy.sh), so a log file written there
// would show up in `git status`.
const TMP_DIR = `/tmp/ags-${GLib.get_user_name()}`
export const BANDWIDTH_BIN = `${TMP_DIR}/bandwidth-loop`

const SOURCE = `${GLib.get_home_dir()}/.config/hypr/scripts/bandwidth-loop.c`

// Called once from app.ts's main(), before anything tries to spawn
// BANDWIDTH_BIN. Synchronous exec, like the old rice's compileBinaries
// — a single small C file compiles well under the time it takes the
// rest of main() to build the bar.
export function compileBandwidthLoop() {
  exec(["bash", "-c", `mkdir -p '${TMP_DIR}' && gcc -O2 -o '${BANDWIDTH_BIN}' '${SOURCE}'`])
}
