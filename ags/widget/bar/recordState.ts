import { createComputed, createState } from "ags"
import { interval } from "ags/time"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"

// Screen-recording state, shared by the bar's red dot and the Control
// Center row. scripts/record.sh owns the truth (a pid + start-time file in
// $XDG_RUNTIME_DIR/screenrecord); this only reads it, so a recording
// started from a keybind, the terminal or the panel all look the same.
//
// The pid is checked against /proc, not just the file's existence: a
// recorder that was killed leaves its files behind, and the bar must not
// show a dot for a recording that isn't happening.

const RT = `${GLib.getenv("XDG_RUNTIME_DIR") ?? "/tmp"}/screenrecord`
const SCRIPT = `${GLib.get_home_dir()}/.config/hypr/scripts/record.sh`

function read(name: string): string {
  try {
    const [ok, bytes] = GLib.file_get_contents(`${RT}/${name}`)
    return ok ? new TextDecoder().decode(bytes).trim() : ""
  } catch {
    return ""
  }
}

// -1 = not recording, otherwise elapsed whole seconds.
export const [elapsed, setElapsed] = createState(-1)
export const recording = createComputed([elapsed], (e) => e >= 0)

function tick() {
  const pid = read("pid")
  if (!pid || !GLib.file_test(`/proc/${pid}`, GLib.FileTest.EXISTS)) {
    setElapsed(-1)
    return
  }
  const start = Number(read("start"))
  setElapsed(start > 0 ? Math.max(0, Math.floor(Date.now() / 1000 - start)) : 0)
}

// 1 s while recording (the elapsed counter), 2 s when idle (just noticing that one started)
function loop() {
  tick()
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, elapsed.peek() >= 0 ? 1000 : 2000, () => { loop(); return GLib.SOURCE_REMOVE })
}
loop()

export function fmtElapsed(s: number): string {
  const m = Math.floor(s / 60)
  const ss = String(s % 60).padStart(2, "0")
  return s >= 3600 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

// `delay` lets a panel finish hiding before the capture starts, so it is
// not the first frame of the recording.
export function toggleRecording(mode: "area" | "screen", delay = 0) {
  setTimeout(() => {
    execAsync([SCRIPT, "toggle", mode])
      .catch((e) => console.error("record.sh failed", e))
      .finally(() => setTimeout(tick, 300))
  }, delay)
}

export function stopRecording() {
  execAsync([SCRIPT, "stop"])
    .catch((e) => console.error("record.sh stop failed", e))
    .finally(() => setTimeout(tick, 300))
}
