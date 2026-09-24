import { Accessor, createBinding, createComputed, createState, For, With } from "ags"
import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"
import { timeout } from "ags/time"
import AstalBluetooth from "gi://AstalBluetooth?version=0.1"
import Menu from "./Menu"
import { openDropdown } from "./dropdown"
import { bluetoothIcon, REFRESH } from "./icons"

// Scope: power, discovery, and connect / disconnect / pair-and-connect
// for devices that need no PIN (headphones, speakers, mice: BlueZ's
// "just works" pairing). Keyboards and anything asking for a passkey
// still want blueman; the failure message says so rather than hanging.
//
// Actions go through `bluetoothctl`, wrapped in `timeout`: connect and
// pair to a device that isn't answering block for minutes otherwise,
// and Astal's connect_device() is callback-based, so awaiting it as a
// Promise "finished" instantly and swallowed every error.
const MAC_NAME = /^([0-9a-f]{2}[-:]){5}[0-9a-f]{2}$/i

// A non-zero exit makes execAsync reject with stderr only, and
// bluetoothctl reports the reason on stdout, so run it through a shell
// that folds both streams together and appends the exit code.
function btctl(seconds: number, ...args: string[]): Promise<string> {
  const script = `out=$(timeout ${seconds} bluetoothctl "$@" 2>&1); rc=$?; printf '%s\\n__rc=%s' "$out" "$rc"`
  return execAsync(["bash", "-c", script, "_", ...args]).then((raw) => {
    const m = raw.match(/\n__rc=(\d+)$/)
    const rc = m ? Number(m[1]) : 1
    const out = m ? raw.slice(0, m.index) : raw
    // bluetoothctl exits 0 on some failures, so read the text as well.
    if (rc !== 0 || (/Failed|not available/i.test(out) && !/successful/i.test(out)))
      throw new Error(rc === 124 ? "timeout" : out)
    return out
  })
}

function friendlyBtError(err: unknown, name: string): string {
  const raw = String(err)
  if (/Authentication|passkey|PIN|Confirm/i.test(raw)) return `${name} needs a PIN, pair it with blueman`
  if (/page-timeout|not available|does not exist|timeout/i.test(raw)) return `${name} is not in range or is off`
  if (/InProgress|AlreadyExists/i.test(raw)) return `${name}: already in progress`
  if (/AlreadyConnected/i.test(raw)) return `${name} is already connected`
  const line = raw.split("\n").map((l) => l.trim()).find((l) => /Failed/i.test(l)) ?? ""
  return line ? `${name}: ${line.replace(/^.*Failed[^:]*: ?/i, "").slice(0, 50)}` : `Could not connect to ${name}`
}

export function BluetoothPanel() {
  const bt = AstalBluetooth.get_default()

  const [busy, setBusy] = createState<string | null>(null)
  const [status, setStatus] = createState<string>("")
  const [devices, setDevices] = createState<AstalBluetooth.Device[]>([])
  const [powered, setPowered] = createState<boolean>(bt.isPowered)
  const [discovering, setDiscovering] = createState<boolean>(false)

  // Plain state fed by signals, for the same reason as the Wi-Fi panel:
  // a binding on one property doesn't see the list or the radio change.
  function refresh() {
    setPowered(bt.isPowered)
    setDiscovering(bt.adapter?.discovering ?? false)
    for (const d of bt.devices ?? []) hookDevice(d)
    setDevices(
      [...(bt.devices ?? [])]
        // A nearby device that hasn't announced a name is aliased to its
        // MAC address; that is noise, not something to pick from.
        .filter((d) => (d.alias || d.name) && !MAC_NAME.test(d.alias ?? d.name ?? ""))
        .sort((a, b) => {
          if (a.connected !== b.connected) return a.connected ? -1 : 1
          if (a.paired !== b.paired) return a.paired ? -1 : 1
          return (a.alias ?? a.name ?? "").localeCompare(b.alias ?? b.name ?? "")
        })
        .slice(0, 8),
    )
  }

  const hooked = new WeakSet<object>()
  function hookDevice(d: AstalBluetooth.Device) {
    if (hooked.has(d)) return
    hooked.add(d)
    for (const sig of ["alias", "name", "paired", "connected"]) d.connect(`notify::${sig}`, refresh)
  }
  function hookAdapter() {
    const a = bt.adapter
    if (!a || hooked.has(a)) return
    hooked.add(a)
    a.connect("notify::discovering", refresh)
  }

  bt.connect("notify::devices", refresh)
  bt.connect("notify::is-powered", refresh)
  bt.connect("device-added", refresh)
  bt.connect("device-removed", refresh)
  bt.connect("notify::adapter", () => {
    hookAdapter()
    refresh()
  })
  hookAdapter()
  refresh()

  let stopTimer: ReturnType<typeof timeout> | null = null
  function scan() {
    const a = bt.adapter
    if (!a || !bt.isPowered) return
    try {
      if (!a.discovering) a.start_discovery()
    } catch (_e) {
      /* already discovering */
    }
    // Discovery left running drains the radio and disturbs audio streams.
    stopTimer?.cancel()
    stopTimer = timeout(15000, () => {
      try {
        if (bt.adapter?.discovering) bt.adapter.stop_discovery()
      } catch (_e) {
        /* ignore */
      }
    })
  }

  // Built once at startup, so rescan whenever the panel is opened.
  openDropdown.subscribe(() => {
    if (openDropdown.peek() !== "bluetooth") return
    refresh()
    scan()
  })

  function setRadio(on: boolean) {
    const run = on
      ? execAsync(["rfkill", "unblock", "bluetooth"]).catch(() => {}).then(() => btctl(8, "power", "on"))
      : btctl(8, "power", "off")
    run
      .then(() => {
        setStatus("")
        if (on) timeout(1000, scan)
      })
      .catch(() => setStatus(`Could not turn Bluetooth ${on ? "on" : "off"}`))
  }

  function activate(dev: AstalBluetooth.Device) {
    if (busy.peek()) return
    const name = dev.alias ?? dev.name ?? "device"
    const addr = dev.address
    setBusy(addr)

    // Pairing while scanning is flaky in BlueZ; stop first.
    try {
      if (bt.adapter?.discovering) bt.adapter.stop_discovery()
    } catch (_e) {
      /* ignore */
    }

    let job: Promise<unknown>
    if (dev.connected) {
      setStatus(`Disconnecting ${name}…`)
      job = btctl(15, "disconnect", addr).then(() => setStatus(`Disconnected ${name}`))
    } else {
      setStatus(dev.paired ? `Connecting ${name}…` : `Pairing ${name}…`)
      const pair = dev.paired
        ? Promise.resolve()
        : btctl(30, "pair", addr).then(() => btctl(8, "trust", addr))
      job = pair
        .then(() => btctl(20, "connect", addr))
        .then(() => setStatus(`Connected to ${name}`))
        .catch((err) => {
          // A half-finished pair leaves a bonded-but-useless entry; drop it
          // so the next attempt starts clean instead of failing the same way.
          if (!dev.paired) btctl(8, "remove", addr).catch(() => {})
          throw err
        })
    }
    job
      .catch((err: unknown) => setStatus(friendlyBtError(err, name)))
      .finally(() => {
        setBusy(null)
        refresh()
      })
  }

  return (
    <box class="Panel BluetoothPanel" orientation={Gtk.Orientation.VERTICAL} spacing={6}>
      <box class="panel-head" spacing={8}>
        <label class="panel-title" label="Bluetooth" xalign={0} hexpand />
        <label
          class="dim"
          label={createComputed([discovering, powered], (d, p) => (p && d ? "Scanning…" : ""))}
        />
        <button class="glyph" tooltipMarkup="Scan for devices" sensitive={powered} onClicked={scan}>
          <image iconName={REFRESH} pixelSize={15} />
        </button>
        <switch
          valign={Gtk.Align.CENTER}
          active={powered}
          $={(self: Gtk.Switch) => {
            self.connect("notify::active", () => {
              if (self.active !== powered.peek()) setRadio(self.active)
            })
          }}
        />
      </box>

      <With value={status}>
        {(s: string) => (s ? <label class="status" label={s} xalign={0} wrap maxWidthChars={30} /> : <box />)}
      </With>

      <label
        class="status"
        label="Bluetooth is off"
        xalign={0}
        visible={createComputed([powered], (p) => !p)}
      />

      <box class="rows" orientation={Gtk.Orientation.VERTICAL} spacing={1} visible={powered}>
        <For each={devices}>
          {(dev: AstalBluetooth.Device) => (
            <button
              class={createComputed(
                [createBinding(dev, "connected"), busy],
                (connected, b) =>
                  `row ${connected ? "active" : ""} ${b === dev.address ? "busy" : ""}`,
              )}
              onClicked={() => activate(dev)}
            >
              <box spacing={8} valign={Gtk.Align.CENTER}>
                <image
                  iconName={createComputed([createBinding(dev, "connected")], (c) =>
                    bluetoothIcon(true, c),
                  )}
                  pixelSize={16}
                />
                <label xalign={0} hexpand label={dev.alias ?? dev.name ?? dev.address} />
                <label
                  class="dim"
                  label={createComputed(
                    [createBinding(dev, "connected"), createBinding(dev, "paired")],
                    (c, p) => (c ? "connected" : p ? "paired" : "new"),
                  )}
                />
              </box>
            </button>
          )}
        </For>
      </box>
    </box>
  )
}

export default function BluetoothMenu(props: { reveal: Accessor<boolean> }) {
  const bt = AstalBluetooth.get_default()

  const powered = createBinding(bt, "isPowered")
  const connected = createBinding(bt, "isConnected")

  return (
    <Menu
      name="bluetooth"
      icon={createComputed([powered, connected], bluetoothIcon)}
      reveal={props.reveal}
      tooltip="Bluetooth"
    />
  )
}
