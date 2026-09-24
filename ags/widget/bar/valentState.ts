import { createState } from "ags"
import { timeout } from "ags/time"
import Gio from "gi://Gio"
import GLib from "gi://GLib"

// Phone integration (SUPER+CTRL+P panel), via Valent — a GTK4/libadwaita
// implementation of the KDE Connect protocol, chosen over the official
// `kdeconnect` package specifically to avoid pulling in KDE Frameworks 6 +
// Qt6 Multimedia on an otherwise pure-GTK system (packages/optional.txt).
//
// Valent has NO Astal wrapper (unlike Bluetooth/Network/Wireplumber), so
// this talks to its D-Bus service directly — same raw `Gio.DBus.session`
// approach PlayerMenu.tsx already uses for MPRIS SetPosition, just fuller:
// it also has to enumerate devices and track a live GActionGroup.
//
// Protocol shape (reverse-engineered 2026-09-22 against a real paired
// phone — Valent has no public D-Bus docs beyond a GitHub discussion
// thread naming the service/object-path convention):
//   service     ca.andyholmes.Valent
//   root object /ca/andyholmes/Valent — org.freedesktop.DBus.ObjectManager
//   each device /ca/andyholmes/Valent/Device/<id> — properties (Id, Name,
//               IconName, State) PLUS org.gtk.Actions: one action per
//               plugin capability (findmyphone.ring, ping.ping, unpair,
//               battery.state, share.*, clipboard.push/pull, sftp.browse,
//               notification.*, …). `battery.state`'s own ACTION STATE
//               (not a property) carries the live reading — {charging,
//               icon-name, is-present, percentage, time-to-empty,
//               time-to-full} — updated via the standard GAction
//               `action-state-changed` signal.
const BUS_NAME = "ca.andyholmes.Valent"
const ROOT_PATH = "/ca/andyholmes/Valent"
const DEVICE_PATH_PREFIX = `${ROOT_PATH}/Device/`
const DEVICE_IFACE = "ca.andyholmes.Valent.Device"

export type PhoneBattery = {
  percentage: number
  charging: boolean
  iconName: string
}

export type PhoneDevice = {
  path: string
  id: string
  name: string
  connected: boolean
  paired: boolean
}

const [available, setAvailable] = createState(false)
const [device, setDevice] = createState<PhoneDevice | null>(null)
const [battery, setBattery] = createState<PhoneBattery | null>(null)

export const phoneServiceAvailable = available
export const phoneDevice = device
export const phoneBattery = battery

const session = Gio.DBus.session
let actionGroup: Gio.DBusActionGroup | null = null
let actionGroupPath: string | null = null
let actionSignalId = 0

// STATE is a bitfield, undocumented — decoded by watching it change live
// while pairing a real phone: 1 (just connected) -> 5 (connected +
// pair-requested) -> 3 (connected + paired) -> 2 (paired, phone went
// idle/backgrounded). So bit 1 = CONNECTED, bit 2 = PAIRED; the third bit
// seen (4) is presumably PAIR_REQUESTED, not decoded here since nothing
// in this panel needs to show it — connected/paired covers every state
// the UI cares about.
function decodeState(bits: number) {
  return { connected: (bits & 1) !== 0, paired: (bits & 2) !== 0 }
}

function attachActionGroup(path: string) {
  if (actionGroupPath === path) return
  detachActionGroup()
  actionGroupPath = path
  actionGroup = Gio.DBusActionGroup.get(session, BUS_NAME, path)
  actionSignalId = actionGroup.connect("action-state-changed", (_ag, name: string, state: GLib.Variant) => {
    if (name === "battery.state") applyBatteryState(state)
  })
  // The group syncs its action list/state asynchronously over D-Bus after
  // `get()` returns — nothing here guarantees the first read lands before
  // that sync completes, so give it a moment, then read once directly
  // rather than wait indefinitely on a signal that only fires on CHANGE.
  timeout(400, () => {
    if (actionGroupPath !== path || !actionGroup) return
    const state = actionGroup.get_action_state("battery.state")
    if (state) applyBatteryState(state)
  })
}

function detachActionGroup() {
  if (actionGroup && actionSignalId) actionGroup.disconnect(actionSignalId)
  actionGroup = null
  actionGroupPath = null
  actionSignalId = 0
  setBattery(null)
}

function applyBatteryState(v: GLib.Variant) {
  const d = v.recursiveUnpack() as Record<string, unknown>
  if (!d || d["is-present"] === false) {
    setBattery(null)
    return
  }
  setBattery({
    percentage: Number(d["percentage"] ?? 0),
    charging: Boolean(d["charging"]),
    iconName: String(d["icon-name"] ?? "battery-missing-symbolic"),
  })
}

function applyManagedObjects(v: GLib.Variant) {
  const [objects] = v.recursiveUnpack() as [Record<string, Record<string, Record<string, unknown>>>]
  const paths = Object.keys(objects).filter((p) => p.startsWith(DEVICE_PATH_PREFIX))

  if (paths.length === 0) {
    setDevice(null)
    detachActionGroup()
    return
  }

  // One phone is the whole use case here — same simplification the
  // Bluetooth/Wi-Fi panels make ("first adapter", "first powered radio")
  // rather than building a multi-device chooser nothing here needs yet.
  const path = paths[0]
  const props = objects[path][DEVICE_IFACE] ?? {}
  const state = decodeState(Number(props["State"] ?? 0))

  setDevice({
    path,
    id: String(props["Id"] ?? ""),
    name: String(props["Name"] ?? "Phone"),
    connected: state.connected,
    paired: state.paired,
  })

  if (state.paired) attachActionGroup(path)
  else detachActionGroup()
}

function refresh() {
  session.call(
    BUS_NAME,
    ROOT_PATH,
    "org.freedesktop.DBus.ObjectManager",
    "GetManagedObjects",
    null,
    GLib.VariantType.new("(a{oa{sa{sv}}})"),
    Gio.DBusCallFlags.NONE,
    -1,
    null,
    (conn, res) => {
      try {
        applyManagedObjects(session.call_finish(res!))
      } catch (_e) {
        // Service dropped mid-call (e.g. vanished right as this landed) —
        // the watch below's vanished handler already clears state for
        // that case, nothing more to do here.
      }
    },
  )
}

// object_path is intentionally null (not ROOT_PATH): a device's own
// PropertiesChanged is emitted BY the device's object path, not the root,
// and paths are dynamic (one per paired phone) so there is no fixed path
// to subscribe to ahead of time. Filtered by prefix in the callback
// instead.
session.signal_subscribe(
  BUS_NAME,
  "org.freedesktop.DBus.ObjectManager",
  null,
  ROOT_PATH,
  null,
  Gio.DBusSignalFlags.NONE,
  () => refresh(),
)
session.signal_subscribe(
  BUS_NAME,
  "org.freedesktop.DBus.Properties",
  "PropertiesChanged",
  null,
  null,
  Gio.DBusSignalFlags.NONE,
  (_conn, _sender, objectPath) => {
    if (objectPath.startsWith(DEVICE_PATH_PREFIX)) refresh()
  },
)

Gio.bus_watch_name(
  Gio.BusType.SESSION,
  BUS_NAME,
  Gio.BusNameWatcherFlags.AUTO_START,
  () => {
    setAvailable(true)
    refresh()
  },
  () => {
    setAvailable(false)
    setDevice(null)
    detachActionGroup()
  },
)

function activate(action: string, param: GLib.Variant | null = null) {
  actionGroup?.activate_action(action, param)
}

export function ringPhone() {
  activate("findmyphone.ring")
}
export function pingPhone(message = "") {
  activate("ping.ping")
  if (message) activate("ping.message", new GLib.Variant("s", message))
}
export function unpairPhone() {
  activate("unpair")
}
export function pairPhone() {
  activate("pair")
}
export function browsePhone() {
  activate("sftp.browse")
}
