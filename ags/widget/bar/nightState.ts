import { createComputed, createState } from "ags"
import { interval } from "ags/time"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"

// Night light, driven through hyprsunset.
//
// The SHELL owns the schedule, not hyprsunset: its own time profiles drop the
// night profile when the daemon (re)starts after the profile's time, until
// the next trigger (omacom/omarchy #12334). So hyprsunset.conf only sets the
// resting state (no colour change) and this module tells it what to do,
// and re-asserts that every minute — which also heals a daemon that was
// restarted or hung underneath us (v0.4.0 can hang with its PID alive and
// its socket orphaned, so `hyprctl hyprsunset` stops answering).
//
// Three modes, one click cycles them: off -> auto -> on -> off.
//   auto = warm between NIGHT_START and NIGHT_END, otherwise off
//   on   = warm until you change it
//
// `hyprctl hyprsunset temperature` returns the last-set value, NOT whether
// the filter is on, so "active" is tracked here.

export type NightMode = "off" | "auto" | "on"

export const NIGHT_TEMP = 4000
const NIGHT_START = 21 * 60 // 21:00, minutes since midnight
const NIGHT_END = 7 * 60 //   07:00

const STATE_DIR = `${GLib.get_user_state_dir()}/hypr-shell`
const STATE_FILE = `${STATE_DIR}/nightlight`

function readMode(): NightMode {
  try {
    const [ok, bytes] = GLib.file_get_contents(STATE_FILE)
    const v = ok ? new TextDecoder().decode(bytes).trim() : ""
    if (v === "on" || v === "auto" || v === "off") return v
  } catch {}
  return "off"
}

function writeMode(m: NightMode) {
  try {
    GLib.mkdir_with_parents(STATE_DIR, 0o755)
    GLib.file_set_contents(STATE_FILE, m)
  } catch (e) {
    console.error("nightlight: could not save state", e)
  }
}

export const [mode, setModeState] = createState<NightMode>(readMode())
export const [active, setActive] = createState(false)

function inWindow(d = new Date()): boolean {
  const m = d.getHours() * 60 + d.getMinutes()
  return NIGHT_START > NIGHT_END ? m >= NIGHT_START || m < NIGHT_END : m >= NIGHT_START && m < NIGHT_END
}

const wanted = () => {
  const m = mode.peek()
  return m === "on" || (m === "auto" && inWindow())
}

const hs = (...args: string[]) => execAsync(["timeout", "3", "hyprctl", "hyprsunset", ...args])

let busy = false

async function restartDaemon() {
  await execAsync(["bash", "-c", "pkill -KILL -x hyprsunset; sleep 0.4; setsid hyprsunset >/dev/null 2>&1 &"]).catch(() => {})
  await new Promise((r) => setTimeout(r, 1200))
}

async function apply() {
  if (busy) return
  busy = true
  const want = wanted()
  const run = () => (want ? hs("temperature", String(NIGHT_TEMP)) : hs("identity"))
  try {
    try {
      await run()
    } catch {
      await restartDaemon() // hung or not running: bring it back once, retry
      await run()
    }
    setActive(want)
  } catch (e) {
    console.error("nightlight: hyprsunset is not responding", e)
    setActive(false)
  } finally {
    busy = false
  }
}

apply()
interval(60_000, apply)

const NEXT: Record<NightMode, NightMode> = { off: "auto", auto: "on", on: "off" }

export function cycleNightLight(): NightMode {
  const next = NEXT[mode.peek()]
  setModeState(next)
  writeMode(next)
  apply()
  return next
}

const hhmm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`

// The one line under the tile / in the tooltip.
export const nightStatus = createComputed([mode, active], (m, a) => {
  if (m === "off") return "Off"
  if (m === "on") return `On · ${NIGHT_TEMP}K`
  return a ? `Auto · until ${hhmm(NIGHT_END)}` : `Auto · from ${hhmm(NIGHT_START)}`
})
