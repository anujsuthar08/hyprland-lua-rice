import { createComputed, createState } from "ags"
import GLib from "gi://GLib"

// Read-only view of the timer that scripts/rofi-timer.py owns. The script records the
// end time in a state file and lets a transient systemd timer do the waiting; this just
// reads that file once a second (a ~200-byte read) so the bar can show the countdown.
// A missing file means nothing is running.

type S = { kind: "timer" | "pomo" | "stopwatch"; label?: string; phase?: string; round?: number; start: number; end?: number }

const FILE = `${GLib.get_user_state_dir()}/hypr-shell/timer.json`

const [state, setState] = createState<S | null>(null)
const [nowMs, setNow] = createState(Date.now())

let lastText = ""
function poll() {
  setNow(Date.now())
  try {
    const [ok, b] = GLib.file_get_contents(FILE)
    const t = ok ? new TextDecoder().decode(b) : ""
    if (t !== lastText) {
      lastText = t
      setState(t ? (JSON.parse(t) as S) : null)
    }
  } catch {
    if (lastText !== "") { lastText = ""; setState(null) }
  }
}
// 1 s while a timer/stopwatch exists (the countdown must move), 5 s otherwise (just noticing a new one)
function loop() {
  poll()
  GLib.timeout_add(GLib.PRIORITY_DEFAULT, lastText ? 1000 : 5000, () => { loop(); return GLib.SOURCE_REMOVE })
}
loop()

const fmt = (sec: number) => {
  sec = Math.max(0, Math.floor(sec))
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`
}

export const timerActive = createComputed([state], (s) => s !== null)
export const timerText = createComputed([state, nowMs], (s, n) => {
  if (!s) return ""
  return s.kind === "stopwatch" ? fmt(n / 1000 - s.start) : fmt((s.end ?? 0) - n / 1000)
})
export const timerTip = createComputed([state], (s) => {
  if (!s) return ""
  if (s.kind === "pomo") return `Pomodoro — ${s.label} (round ${s.round}) · click to manage`
  return `${s.label || (s.kind === "stopwatch" ? "Stopwatch" : "Timer")} · click to manage`
})
export const timerClass = createComputed([state], (s) => (s?.kind === "pomo" && s.phase !== "work" ? "glyph timer rest" : "glyph timer"))
