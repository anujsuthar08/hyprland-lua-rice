import { createComputed, createState } from "ags"
import { interval } from "ags/time"
import Gio from "gi://Gio"
import GLib from "gi://GLib"

// Battery care: how worn the battery is, and an 80 % charge limit (keeping a lithium
// cell below full slows its ageing; the usual advice for a laptop that lives on the desk).
//
// Health = charge_full / charge_full_design from sysfs (AstalBattery does not expose the
// design capacity; UPower's "capacity" line is the same ratio).
//
// The limit is the kernel's charge_control_end_threshold, which only root may write. Until
// scripts/battery-limit-setup.sh has been run once (needs sudo), `canWrite` is false and the
// panel says how to enable it instead of showing a switch that would do nothing.
// The chosen limit is remembered and re-applied at login (a fresh boot can reset it).

const CLASS = "/sys/class/power_supply"
const STATE_FILE = `${GLib.get_user_state_dir()}/hypr-shell/charge-limit`
export const LIMIT = 80

const num = (p: string): number | null => {
  try {
    const [ok, b] = GLib.file_get_contents(p)
    const n = ok ? Number(new TextDecoder().decode(b).trim()) : NaN
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

function findBattery(): string | null {
  try {
    const d = Gio.File.new_for_path(CLASS)
    const en = d.enumerate_children("standard::name", Gio.FileQueryInfoFlags.NONE, null)
    let i: Gio.FileInfo | null
    while ((i = en.next_file(null))) {
      const n = i.get_name()
      if (n.startsWith("BAT")) return `${CLASS}/${n}`
    }
  } catch {}
  return null
}

const BAT = findBattery()
const THRESHOLD = BAT ? `${BAT}/charge_control_end_threshold` : null

export const [health, setHealth] = createState<number | null>(null) // 0..100
export const [limit, setLimit] = createState<number | null>(null) // current end threshold, %
export const [canWrite, setCanWrite] = createState(false)

export const supportsLimit = createComputed([limit], (l) => l !== null)
export const limitOn = createComputed([limit], (l) => l !== null && l <= LIMIT)

function writable(p: string): boolean {
  try {
    const info = Gio.File.new_for_path(p).query_info("access::can-write", Gio.FileQueryInfoFlags.NONE, null)
    return info.get_attribute_boolean("access::can-write")
  } catch {
    return false
  }
}

function refresh() {
  if (!BAT) return
  const full = num(`${BAT}/charge_full`) ?? num(`${BAT}/energy_full`)
  const design = num(`${BAT}/charge_full_design`) ?? num(`${BAT}/energy_full_design`)
  setHealth(full && design ? Math.min(100, Math.round((100 * full) / design)) : null)
  if (THRESHOLD) {
    setLimit(num(THRESHOLD))
    setCanWrite(writable(THRESHOLD))
  }
}

export function setChargeLimit(on: boolean) {
  if (!THRESHOLD || !canWrite.peek()) return
  const v = on ? LIMIT : 100
  try {
    GLib.file_set_contents(THRESHOLD, String(v))
    GLib.mkdir_with_parents(`${GLib.get_user_state_dir()}/hypr-shell`, 0o755)
    GLib.file_set_contents(STATE_FILE, String(v))
  } catch (e) {
    console.error("batteryCare: could not set the charge limit", e)
  }
  refresh()
}

// Re-apply the remembered choice (a reboot or firmware update can reset the threshold).
function reapply() {
  if (!THRESHOLD || !canWrite.peek()) return
  const want = num(STATE_FILE)
  const cur = num(THRESHOLD)
  if (want !== null && cur !== null && want !== cur) {
    try { GLib.file_set_contents(THRESHOLD, String(want)) } catch {}
    refresh()
  }
}

refresh()
reapply()
interval(30_000, refresh)
