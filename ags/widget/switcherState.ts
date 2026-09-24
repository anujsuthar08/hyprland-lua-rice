import { createState } from "ags"
import { execAsync } from "ags/process"
import { timeout, Timer } from "ags/time"

// Alt-Tab window switcher, the state half. `ags request -i shell switcher next|prev|commit|cancel`
// is driven by binds in conf/binds.lua: ALT+Tab / ALT+SHIFT+Tab step through the windows,
// and RELEASING Alt commits (the pattern hyprswitch uses: a release bind on Alt_L).
//
// Order is most-recently-used: `hyprctl clients` reports focusHistoryID (0 = the focused
// window, 1 = the one before it...). The first step lands on the PREVIOUS window, so a quick
// Alt+Tab toggles between two windows, as everywhere else.

export type Win = { address: string; cls: string; title: string; workspace: number; special: boolean }

export const [items, setItems] = createState<Win[]>([])
export const [selected, setSelected] = createState(0)
export const [open, setOpen] = createState(false)

// If the Alt release is somehow missed (a lost key event), do not leave an overlay stuck on screen.
const IDLE_MS = 6000
let idle: Timer | null = null
const arm = () => { idle?.cancel(); idle = timeout(IDLE_MS, cancel) }

async function list(): Promise<Win[]> {
  const raw = JSON.parse(String(await execAsync(["hyprctl", "clients", "-j"]))) as any[]
  return raw
    .filter((c) => c.mapped && !c.hidden)
    .sort((a, b) => a.focusHistoryID - b.focusHistoryID)
    .map((c) => ({
      address: c.address as string,
      cls: (c.class as string) || (c.initialClass as string) || "",
      title: (c.title as string) || (c.class as string) || "",
      workspace: c.workspace?.id ?? 0,
      special: (c.workspace?.name as string | undefined)?.startsWith("special") ?? false,
    }))
}

let busy = false
export async function step(dir: 1 | -1): Promise<string> {
  if (busy) return "busy"
  busy = true
  try {
    if (!open.peek()) {
      const w = await list()
      if (w.length === 0) return "no windows"
      setItems(w)
      // first step: the previous window (or the last one when going backwards)
      setSelected(w.length === 1 ? 0 : dir === 1 ? 1 : w.length - 1)
      setOpen(true)
    } else {
      const n = items.peek().length
      setSelected((s) => (s + dir + n) % n)
    }
    arm()
    return `selected ${selected.peek()} of ${items.peek().length}`
  } finally {
    busy = false
  }
}

export async function commit(): Promise<string> {
  if (!open.peek()) return "closed"
  const w = items.peek()[selected.peek()]
  idle?.cancel()
  setOpen(false)
  if (!w) return "nothing selected"
  // one window in the list = the one already focused: nothing to do
  await execAsync(["hyprctl", "dispatch", `hl.dsp.focus({ window = "address:${w.address}" })`]).catch((e) =>
    console.error("switcher: focus failed", e))
  return `focused ${w.cls}`
}

export function cancel(): string {
  idle?.cancel()
  setOpen(false)
  return "cancelled"
}
