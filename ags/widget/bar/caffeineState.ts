import { createState } from "ags"
import { interval } from "ags/time"
import { execAsync } from "ags/process"

// Caffeine: keep the screen awake (no dim, no auto-lock) while it is on.
//
// The mechanism is a systemd idle inhibitor held by a transient user unit,
// `hypr-caffeine.service`. hypridle honours those (it logs "systemd idle inhibit
// active"), so nothing here talks to hypridle. The unit IS the state: it
// survives a shell restart, and if the unit dies the inhibitor dies with it, so
// the bar can never say "on" while the lock still fires. It is not persisted
// across logins on purpose — caffeine left on by accident is worse than off.
//
// Manual lock (SUPER+L) still works; this only stops the IDLE timeouts.

const UNIT = "hypr-caffeine.service"

export const [caffeine, setCaffeine] = createState(false)
let busy = false

async function probe() {
  try {
    const out = await execAsync(["systemctl", "--user", "is-active", UNIT])
    setCaffeine(String(out).trim() === "active")
  } catch {
    setCaffeine(false) // is-active exits non-zero when inactive
  }
}

export async function toggleCaffeine(): Promise<string> {
  if (busy) return "busy"
  busy = true
  try {
    if (caffeine.peek()) {
      await execAsync(["systemctl", "--user", "stop", UNIT]).catch(() => {})
    } else {
      await execAsync([
        "systemd-run", "--user", `--unit=${UNIT.replace(".service", "")}`, "--collect", "--quiet",
        "systemd-inhibit", "--what=idle", "--who=Caffeine", "--why=Keep the screen awake", "--mode=block",
        "sleep", "infinity",
      ])
    }
  } catch (e) {
    console.error("caffeine: toggle failed", e)
  } finally {
    busy = false
    await probe()
  }
  return caffeine.peek() ? "caffeine on" : "caffeine off"
}

probe()
interval(30_000, probe) // notice a change made from a terminal (toggling from the shell refreshes at once)
