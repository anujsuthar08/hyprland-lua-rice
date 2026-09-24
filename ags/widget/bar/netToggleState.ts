import { createComputed, createState } from "ags"
import { interval } from "ags/time"
import { execAsync } from "ags/process"
import GLib from "gi://GLib"

// Airplane mode, VPN and hotspot for the Control Center. All decisions live in
// scripts/net-toggles.py (testable with a fake nmcli); this only asks it for
// `state` every minute and after each action, and runs the action.

type Vpn = { name: string; active: boolean }
type S = { airplane: boolean; vpns: Vpn[]; hotspot: { active: boolean; available: boolean } }

const SCRIPT = `${GLib.get_home_dir()}/.config/hypr/scripts/net-toggles.py`

const EMPTY: S = { airplane: false, vpns: [], hotspot: { active: false, available: false } }
export const [net, setNet] = createState<S>(EMPTY)

let busy = false
export async function refreshNet() {
  try {
    setNet(JSON.parse(String(await execAsync([SCRIPT, "state"]))) as S)
  } catch {
    /* keep the last state; a failed probe must not blank the tiles */
  }
}

async function act(...args: string[]) {
  if (busy) return
  busy = true
  try {
    await execAsync([SCRIPT, ...args])
  } catch (e) {
    console.error("net-toggles:", args.join(" "), e)
  } finally {
    busy = false
    await refreshNet()
  }
}

export const toggleAirplane = () => act("airplane", net.peek().airplane ? "off" : "on")
export const toggleHotspot = () => act("hotspot", net.peek().hotspot.active ? "off" : "on")
export const toggleVpn = () => {
  const v = net.peek().vpns
  const on = v.find((x) => x.active)
  if (on) return act("vpn", on.name, "down")
  if (v[0]) return act("vpn", v[0].name, "up")
}

export const airplaneOn = createComputed([net], (n) => n.airplane)
export const hasVpn = createComputed([net], (n) => n.vpns.length > 0)
export const vpnOn = createComputed([net], (n) => n.vpns.some((x) => x.active))
export const vpnStatus = createComputed([net], (n) => {
  const on = n.vpns.find((x) => x.active)
  return on ? on.name : n.vpns.length > 1 ? `${n.vpns.length} profiles` : "Off"
})
export const hotspotAvailable = createComputed([net], (n) => n.hotspot.available)
export const hotspotOn = createComputed([net], (n) => n.hotspot.active)

refreshNet()
interval(60_000, refreshNet) // one python + nmcli/rfkill probe; every action refreshes at once
