import AstalBattery from "gi://AstalBattery?version=0.1"
import AstalNotifd from "gi://AstalNotifd?version=0.1"
import { execAsync } from "ags/process"

// Low-battery warnings. Nothing on this desktop watched the battery: the bar's icon
// changed colour and that was all. The system policy (UPower) is 20 % "low", 5 %
// "critical", and at 2 % it acts WITHOUT warning — and with no swap / no resume=
// on the kernel command line, hibernate is impossible, so "Auto" means the machine
// powers off and unsaved work is lost. So the notifications say exactly that.
//
// One notification per tier per discharge (no nagging), the most severe applicable
// tier only (starting the shell at 8 % gives one message, not three), tiers reset on
// plugging in (and the notifications we sent are dismissed), and a small hysteresis
// so a battery bouncing around a threshold does not repeat itself.

type Tier = { at: number; key: string; urgency: "normal" | "critical"; title: string; body: (mins: number | null) => string }

const left = (m: number | null) => (m && m > 0 ? `about ${m < 90 ? `${m} min` : `${(m / 60).toFixed(1)} h`} left` : "")

const TIERS: Tier[] = [
  { at: 20, key: "low", urgency: "normal", title: "Battery low",
    body: (m) => `20% — ${left(m) || "plug in soon"}` },
  { at: 10, key: "very-low", urgency: "normal", title: "Battery very low",
    body: (m) => `10% — ${left(m) ? left(m) + ". " : ""}Plug in soon.` },
  { at: 5, key: "critical", urgency: "critical", title: "Battery critical — plug in now",
    body: (m) => `5%${m ? `, ${left(m)}` : ""}. The system powers off at 2% and unsaved work will be lost.` },
]
const HYSTERESIS = 3 // a tier re-arms only once the level is this far above it

const notifd = AstalNotifd.get_default()
const battery = AstalBattery.get_default()

const fired = new Set<string>()
const sent = new Map<string, number>() // tier key -> notification id (to dismiss on plug-in)

let sim: { pct: number; charging: boolean } | null = null

function dismissMine() {
  for (const id of sent.values()) {
    try {
      notifd.get_notification(id)?.dismiss()
    } catch {}
  }
  sent.clear()
}

async function fire(t: Tier, mins: number | null) {
  try {
    const out = await execAsync([
      "notify-send", "-a", "Battery", "-u", t.urgency, "-p",
      t.title, t.body(mins),
    ])
    const id = Number(String(out).trim())
    if (Number.isFinite(id)) sent.set(t.key, id)
  } catch (e) {
    console.error("batteryWatch: notify-send failed", e)
  }
}

// pct: 0..100. Pure decision logic; returns what it did (used by the simulation).
export function evaluate(pct: number, charging: boolean, mins: number | null): string {
  if (charging) {
    const had = fired.size > 0
    dismissMine()
    fired.clear()
    return had ? "charging: cleared warnings and re-armed" : "charging"
  }
  // re-arm tiers the level has clearly recovered from (e.g. a charger that was too weak)
  for (const t of TIERS) if (pct > t.at + HYSTERESIS) fired.delete(t.key)

  const due = TIERS.filter((t) => pct <= t.at) // ascending "at" order is not guaranteed; pick most severe
  if (due.length === 0) return "no tier reached"
  const pending = due.filter((t) => !fired.has(t.key))
  for (const t of due) fired.add(t.key) // starting low: do not also replay the milder tiers later
  if (pending.length === 0) return "already warned for this level"
  const worst = pending.reduce((a, b) => (b.at < a.at ? b : a))
  fire(worst, mins)
  return `notified: ${worst.title}`
}

function realTick() {
  if (sim || !battery.isPresent) return
  const mins = battery.timeToEmpty > 0 ? Math.round(battery.timeToEmpty / 60) : null
  evaluate(battery.percentage * 100, battery.charging, mins)
}

if (battery.isPresent) {
  for (const sig of ["notify::percentage", "notify::charging", "notify::state"]) battery.connect(sig, realTick)
  realTick()
}

// `ags request -i shell battery-sim <percent> [charging|discharging]`, `battery-sim off`
export function simulate(args: string[]): string {
  if (args[0] === "off" || args.length === 0) {
    sim = null
    dismissMine()
    fired.clear()
    realTick() // re-evaluate the REAL battery now instead of waiting for its next change
    return "simulation off; real battery is used again"
  }
  const pct = Number(args[0])
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return "usage: battery-sim <0-100> [charging|discharging] | off"
  sim = { pct, charging: args[1] === "charging" }
  return `${pct}% ${sim.charging ? "charging" : "discharging"} -> ${evaluate(pct, sim.charging, pct > 5 ? Math.round(pct * 1.6) : 6)}`
}
