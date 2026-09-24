import { execAsync } from "ags/process"
import { createPoll } from "ags/time"
import GLib from "gi://GLib"

// Backlight, read from sysfs and written with brightnessctl.
//
// Reading is a file read rather than `brightnessctl -m` on a timer:
// this polls every couple of seconds while a panel is open, and
// spawning a process for that is thirty fork/execs a minute for two
// integers. Writing still goes through brightnessctl, which owns the
// udev rule that makes the sysfs file writable without root.

const ROOT = "/sys/class/backlight"

function firstDevice(): string | null {
  try {
    const dir = GLib.Dir.open(ROOT, 0)
    let name: string | null
    while ((name = dir.read_name()) !== null) return name
  } catch (e) {
    // no backlight at all — a desktop, or a GPU that exposes none
  }
  return null
}

const DEVICE = firstDevice()

function readInt(path: string): number {
  const [ok, bytes] = GLib.file_get_contents(path)
  if (!ok) return 0
  return parseInt(new TextDecoder().decode(bytes).trim(), 10) || 0
}

export const hasBacklight = DEVICE !== null

/** Current backlight, 0..1. Polls only while something is watching. */
export function createBrightness(intervalMs = 2000) {
  return createPoll(0, intervalMs, () => {
    if (!DEVICE) return 0
    const max = readInt(`${ROOT}/${DEVICE}/max_brightness`)
    if (max <= 0) return 0
    return readInt(`${ROOT}/${DEVICE}/brightness`) / max
  })
}

/** Set backlight to 0..1. Floored at 1% — a dark screen is unusable. */
export function setBrightness(value: number) {
  const pct = Math.round(Math.max(0.01, Math.min(1, value)) * 100)
  execAsync(["brightnessctl", "--quiet", "set", `${pct}%`]).catch((e) =>
    console.error("brightnessctl failed", e),
  )
}


