import { createState } from "ags"
import { execAsync } from "ags/process"
import { timeout } from "ags/time"
import GLib from "gi://GLib"

// Cursor click highlighter — a visual ripple at the click point, for
// tutorial-quality screen recordings (pairs with record.sh / SUPER+SHIFT+R).
// scripts/click-highlight.py owns the truth (a pid file in
// $XDG_RUNTIME_DIR/click-highlight, same shape as record.sh's own state) and
// pushes each click here via `ags request -i shell click-highlight x,y,button`
// (app.ts) — this module just holds what the overlay widget renders.

const RT = `${GLib.getenv("XDG_RUNTIME_DIR") ?? "/tmp"}/click-highlight`
const SCRIPT = `${GLib.get_home_dir()}/.config/hypr/scripts/click-highlight.py`
const RIPPLE_MS = 500

export type ClickEvent = { x: number; y: number; button: string }

const [enabled, setEnabled] = createState(false)
const [active, setActive] = createState(false)
const [last, setLast] = createState<ClickEvent | null>(null)

export const highlightEnabled = enabled
export const highlightActive = active
export const lastClick = last

function pidAlive(): boolean {
  try {
    const [ok, bytes] = GLib.file_get_contents(`${RT}/pid`)
    const pid = ok ? new TextDecoder().decode(bytes).trim() : ""
    return !!pid && GLib.file_test(`/proc/${pid}`, GLib.FileTest.EXISTS)
  } catch {
    return false
  }
}

// Called once at startup so the toggle reflects reality even if the daemon
// was already running from a previous shell instance (crash-restart, or
// started by hand for testing) — same "read state, don't assume" approach
// recordState.ts uses for the recorder's own pid file.
setEnabled(pidAlive())

// Re-checks the real pid, not the in-memory `enabled` state, before
// deciding start vs stop — found live: the daemon is a plain background
// process (KillMode=control-group on hypr-shell.service kills it on
// every shell restart, same as any other execAsync child), so `enabled`
// can go stale (still true after the daemon actually died) and a naive
// `!enabled.peek()` toggle then sends "stop" to nothing — a silent no-op
// that looks like the keybind just didn't work. Checking `pidAlive()`
// fresh here means every single press is correct, not just eventually
// self-correcting after one wasted click.
export function toggleHighlight() {
  const next = !pidAlive()
  execAsync(["python3", SCRIPT, next ? "start" : "stop"])
    .catch((e) => console.error("click-highlight.py failed", e))
  setEnabled(next)
}

let resetTimer: ReturnType<typeof timeout> | null = null

// Called from app.ts's requestHandler. Retriggers the ripple even if one is
// already mid-animation — same off-then-on-next-tick technique Clock.tsx
// uses for its minute-tick pulse, so a rapid second click restarts the CSS
// animation instead of the class toggle being a no-op.
export function fireClick(ev: ClickEvent) {
  setLast(ev)
  resetTimer?.cancel()
  if (active.peek()) {
    setActive(false)
    timeout(1, () => setActive(true))
  } else {
    setActive(true)
  }
  resetTimer = timeout(RIPPLE_MS, () => setActive(false))
}
