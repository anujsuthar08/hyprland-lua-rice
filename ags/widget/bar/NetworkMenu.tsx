import { Accessor, createBinding, createComputed, createState, For, With } from "ags"
import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"
import { timeout } from "ags/time"
import GLib from "gi://GLib"
import AstalNetwork from "gi://AstalNetwork?version=0.1"
import Menu from "./Menu"
import { openDropdown } from "./dropdown"

import { ADD_NETWORK, REFRESH, SECURED, SELECTED, WIFI_OFF, WIRED, wifiIcon } from "./icons"

// Listing comes from Astal (access points, strength, requiresPassword);
// the actual connect goes through `nmcli`, deliberately. AstalNetwork's
// Wifi wrapper exposes deactivate_connection() but nothing to bring a
// NEW connection up: that needs NetworkManager's AddAndActivate with a
// hand-built 802-11-wireless-security setting, which is a lot of fragile
// GJS for something `nmcli device wifi connect` does correctly already.
// nmcli prints "Warning: ..." lines before the real "Error: ..." one, so
// the first line is often noise. Pick the Error line and translate the
// common failures into something a person would say.
function friendlyError(raw: string, ssid: string): string {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean)
  const line = lines.find((l) => /^Error:/i.test(l)) ?? lines.find((l) => !/^Warning:/i.test(l)) ?? ""
  const msg = line.replace(/^Error:\s*/i, "")
  if (/secrets were required|no secrets|password|802-1x|\(7\)/i.test(msg)) return `Wrong password for ${ssid}`
  if (/no network with ssid/i.test(msg)) return `${ssid} is out of range`
  if (/timeout/i.test(msg)) return `Timed out connecting to ${ssid}`
  return msg || `Could not connect to ${ssid}`
}

export function NetworkPanel() {
  const net = AstalNetwork.get_default()

  const [pending, setPending] = createState<string | null>(null)
  const [status, setStatus] = createState<string>("")
  const [password, setPassword] = createState<string>("")

  // The scan list is capped at the 8 strongest SSIDs (readability), and
  // a hidden network never appears in a scan at all. This is the escape
  // hatch: type any SSID directly, same nmcli path as a listed AP.
  const [manualEntry, setManualEntry] = createState<boolean>(false)
  const [manualSsid, setManualSsid] = createState<string>("")
  const [manualPassword, setManualPassword] = createState<string>("")

  // Plain state fed by signal handlers. The previous version derived the
  // list from createBinding(net, "wifi"), which only fires when the wifi
  // OBJECT is replaced (basically never), so scan results, the radio
  // switch and the active SSID never updated after first render.
  const [aps, setAps] = createState<AstalNetwork.AccessPoint[]>([])
  const [enabled, setEnabled] = createState<boolean>(net.wifi?.enabled ?? false)
  const [scanning, setScanning] = createState<boolean>(false)
  const [activeSsid, setActive] = createState<string | null>(null)
  const [saved, setSaved] = createState<Set<string>>(new Set())

  function refresh() {
    const w = net.wifi
    if (!w) {
      setAps([])
      setEnabled(false)
      setScanning(false)
      setActive(null)
      return
    }
    // Several APs can advertise the same SSID (one per band/BSSID); show
    // the strongest of each so the list reads as "networks", not radios.
    const best = new Map<string, AstalNetwork.AccessPoint>()
    for (const ap of w.accessPoints) {
      if (!ap.ssid) continue
      const existing = best.get(ap.ssid)
      if (!existing || ap.strength > existing.strength) best.set(ap.ssid, ap)
    }
    setAps([...best.values()].sort((a, b) => b.strength - a.strength).slice(0, 8))
    setEnabled(w.enabled)
    setScanning(w.scanning)
    setActive(w.ssid ?? null)
  }

  function loadSaved() {
    execAsync(["nmcli", "-t", "-f", "NAME,TYPE", "connection", "show"])
      .then((out) => {
        const names = new Set<string>()
        for (const line of out.split("\n")) {
          const i = line.lastIndexOf(":")
          if (i < 0 || line.slice(i + 1) !== "802-11-wireless") continue
          names.add(line.slice(0, i).replace(/\\:/g, ":"))
        }
        setSaved(names)
      })
      .catch(() => {})
  }

  function scan() {
    // Astal's scan() errors if NM is already scanning or the radio is
    // off; neither is worth surfacing.
    try {
      net.wifi?.scan()
    } catch (_e) {
      /* ignore */
    }
  }

  const hooked = new WeakSet<object>()
  function hook() {
    const w = net.wifi
    if (!w || hooked.has(w)) return
    hooked.add(w)
    for (const sig of ["access-points", "enabled", "scanning", "ssid"])
      w.connect(`notify::${sig}`, refresh)
  }
  net.connect("notify::wifi", () => {
    hook()
    refresh()
  })
  hook()
  refresh()
  loadSaved()
  scan()

  // Panels are built once at startup, so rescan each time it is opened.
  openDropdown.subscribe(() => {
    if (openDropdown.peek() !== "network") return
    loadSaved()
    refresh()
    scan()
  })

  function setRadio(on: boolean) {
    execAsync(["nmcli", "radio", "wifi", on ? "on" : "off"])
      .then(() => {
        setStatus("")
        if (on) timeout(1500, scan)
      })
      .catch((err) => setStatus(String(err).split("\n")[0].replace(/^Error:\s*/, "")))
  }

  function connect(ssid: string, secret?: string, onSuccess?: () => void, hidden = false) {
    setStatus(`Connecting to ${ssid}…`)
    const wasSaved = saved.peek().has(ssid)
    // Failing to join a network still tears down the current one, so
    // remember it and restore it if this attempt doesn't work out.
    const previous = activeSsid.peek()
    // A saved profile is brought up by name; `device wifi connect` on a
    // known SSID would mint a duplicate "<ssid> 1" profile.
    // Manual entry is for networks that aren't in the scan (hidden), and
    // nmcli refuses those unless told `hidden yes`.
    const extra = hidden ? ["hidden", "yes"] : []
    const cmd =
      wasSaved && !secret
        ? ["nmcli", "connection", "up", "id", ssid]
        : secret
          ? ["nmcli", "device", "wifi", "connect", ssid, "password", secret, ...extra]
          : ["nmcli", "device", "wifi", "connect", ssid, ...extra]

    execAsync(cmd)
      .then(() => {
        setStatus(`Connected to ${ssid}`)
        loadSaved()
        onSuccess?.()
      })
      .catch((err) => {
        setStatus(friendlyError(String(err), ssid))
        // A failed first-time connect leaves a broken profile behind that
        // would then be "saved" and never re-prompt for the password.
        if (!wasSaved) execAsync(["nmcli", "connection", "delete", "id", ssid]).catch(() => {})
        else setPending(ssid) // saved secret is stale: ask again
        if (previous && previous !== ssid && saved.peek().has(previous))
          execAsync(["nmcli", "connection", "up", "id", previous]).catch(() => {})
      })
  }

  return (
    <box class="Panel NetworkPanel" orientation={Gtk.Orientation.VERTICAL} spacing={6}>
      <box class="panel-head" spacing={8}>
        <label class="panel-title" label="Wi-Fi" xalign={0} hexpand />
        <label
          class="dim"
          label={createComputed([scanning, enabled], (sc, en) => (en && sc ? "Scanning…" : ""))}
        />
        <button class="glyph" tooltipMarkup="Rescan" sensitive={enabled} onClicked={scan}>
          <image iconName={REFRESH} pixelSize={15} />
        </button>
        <switch
          valign={Gtk.Align.CENTER}
          active={enabled}
          $={(self: Gtk.Switch) => {
            self.connect("notify::active", () => {
              if (self.active !== enabled.peek()) setRadio(self.active)
            })
          }}
        />
      </box>

      <With value={createComputed([status], (s) => s)}>
        {(s: string) => (s ? <label class="status" label={s} xalign={0} wrap maxWidthChars={30} /> : <box />)}
      </With>

      <label
        class="status"
        label="Wi-Fi is off"
        xalign={0}
        visible={createComputed([enabled], (e) => !e)}
      />

      <box class="rows" orientation={Gtk.Orientation.VERTICAL} spacing={1} visible={enabled}>
        <box class="ap-list" orientation={Gtk.Orientation.VERTICAL} spacing={1}>
        <For each={aps}>
          {(ap: AstalNetwork.AccessPoint) => (
            <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
              <button
                class={createComputed(
                  [activeSsid],
                  (active) => `row ${active === ap.ssid ? "active" : ""}`,
                )}
                onClicked={() => {
                  if (ap.requiresPassword && !saved.peek().has(ap.ssid!)) {
                    // Already-saved networks connect without a prompt;
                    // only ask once nmcli says it needs a secret.
                    setPending(ap.ssid)
                    setManualEntry(false)
                    setStatus("")
                  } else {
                    connect(ap.ssid!)
                  }
                }}
              >
                <box spacing={8} valign={Gtk.Align.CENTER}>
                  <image iconName={wifiIcon(ap.strength)} pixelSize={16} />
                  <label xalign={0} hexpand label={ap.ssid ?? ""} valign={Gtk.Align.CENTER} />
                  {ap.requiresPassword ? <image class="dim" iconName={SECURED} pixelSize={12} /> : <box />}
                  <label
                    class="dim"
                    label={createComputed(
                      [activeSsid, createBinding(ap, "strength")],
                      (active, st) => (active === ap.ssid ? "" : `${st}%`),
                    )}
                  />
                  <image
                    class="tick"
                    iconName={SELECTED}
                    pixelSize={14}
                    visible={createComputed([activeSsid], (active) => active === ap.ssid)}
                  />
                </box>
              </button>

              <With value={pending}>
                {(p: string | null) =>
                  p === ap.ssid ? (
                    <box class="password-row" spacing={6}>
                      <entry
                        hexpand
                        visibility={false}
                        placeholderText={`Password for ${ap.ssid}`}
                        $={(self: Gtk.Entry) => {
                          // Wire the GObject signals directly rather than
                          // trusting an onNotifyText-style prop: nothing
                          // in this codebase has exercised entry props
                          // before, and $= is the documented escape hatch.
                          self.connect("notify::text", () => setPassword(self.text))
                          self.connect("activate", () =>
                            connect(ap.ssid!, self.text, () => {
                              setPending(null)
                              setPassword("")
                            }),
                          )
                          self.grab_focus()
                        }}
                      />
                      <button
                        class="confirm"
                        onClicked={() =>
                          connect(ap.ssid!, password.peek(), () => {
                            setPending(null)
                            setPassword("")
                          })
                        }
                      >
                        <label label="Connect" />
                      </button>
                    </box>
                  ) : (
                    <box />
                  )
                }
              </With>
            </box>
          )}
        </For>
        </box>

        <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
          <button
            class={createComputed([manualEntry], (open) => `row ${open ? "active" : ""}`)}
            onClicked={() => {
              setPending(null)
              setStatus("")
              setManualEntry(!manualEntry.peek())
            }}
          >
            <box spacing={8} valign={Gtk.Align.CENTER}>
              <image iconName={ADD_NETWORK} pixelSize={16} />
              <label xalign={0} hexpand label="Other network…" valign={Gtk.Align.CENTER} />
            </box>
          </button>

          <With value={manualEntry}>
            {(open: boolean) =>
              open ? (
                <box class="password-row" orientation={Gtk.Orientation.VERTICAL} spacing={4}>
                  <entry
                    hexpand
                    placeholderText="Network name (SSID)"
                    $={(self: Gtk.Entry) => {
                      self.connect("notify::text", () => setManualSsid(self.text))
                      self.grab_focus()
                    }}
                  />
                  <box spacing={6}>
                    <entry
                      hexpand
                      visibility={false}
                      placeholderText="Password (leave blank if open)"
                      $={(self: Gtk.Entry) => {
                        self.connect("notify::text", () => setManualPassword(self.text))
                        self.connect("activate", () => {
                          const ssid = manualSsid.peek().trim()
                          if (!ssid) return
                          connect(ssid, manualPassword.peek() || undefined, () => {
                            setManualEntry(false)
                            setManualSsid("")
                            setManualPassword("")
                          }, true)
                        })
                      }}
                    />
                    <button
                      class="confirm"
                      onClicked={() => {
                        const ssid = manualSsid.peek().trim()
                        if (!ssid) return
                        connect(ssid, manualPassword.peek() || undefined, () => {
                          setManualEntry(false)
                          setManualSsid("")
                          setManualPassword("")
                        }, true)
                      }}
                    >
                      <label label="Connect" />
                    </button>
                  </box>
                </box>
              ) : (
                <box />
              )
            }
          </With>
        </box>
      </box>
    </box>
  )
}

export default function NetworkMenu(props: { reveal: Accessor<boolean> }) {
  const net = AstalNetwork.get_default()

  const primary = createBinding(net, "primary")
  const wifi = createBinding(net, "wifi")
  const connectivity = createBinding(net, "connectivity")
  // Nested path so it re-fires on the radio toggling, not just on the
  // wifi object being replaced.
  const radioOn = createBinding(net, "wifi", "enabled")

  // Association and real internet reachability are independent (see
  // Network.tsx) — an AP that lost power can leave wifi looking
  // associated for a while, so the trigger has to check connectivity
  // too rather than declaring victory the moment there's an SSID.
  const noInternet = (c: AstalNetwork.Connectivity) =>
    c === AstalNetwork.Connectivity.NONE ||
    c === AstalNetwork.Connectivity.PORTAL ||
    c === AstalNetwork.Connectivity.LIMITED

  const icon = createComputed([primary, wifi, connectivity], (p, w, c) => {
    if (p === AstalNetwork.Primary.WIRED) return WIRED
    if (!w || w.strength < 0) return WIFI_OFF
    if (noInternet(c)) return WIFI_OFF
    return wifiIcon(w.strength)
  })

  const value = createComputed([primary, wifi, connectivity, radioOn], (p, w, c, on) => {
    if (p === AstalNetwork.Primary.WIRED) return "Ethernet"
    if (w && !on) return "Wi-Fi off"
    const s = w?.ssid
    if (!s) return "Offline"
    if (c === AstalNetwork.Connectivity.PORTAL) return "Sign-in required"
    if (c === AstalNetwork.Connectivity.LIMITED) return "Limited connection"
    if (c === AstalNetwork.Connectivity.NONE) return "No internet"
    return s.length > 18 ? `${s.slice(0, 17)}…` : s
  })

  return (
    <Menu
      name="network"
      icon={icon}
      value={value}
      reveal={props.reveal}
      tooltip="Right-click to toggle Wi-Fi · click for networks"
      setup={(self) => {
        // Toggle the Wi-Fi radio without opening the dropdown (09-bar-
        // interaction-research.md, item 5). Wired connections are
        // unaffected — this only ever touches `net.wifi`.
        // ⚠️ Same synthetic-click unreliability as VolumeMenu.tsx's
        // right-click gesture — see the note there (04-build-state.md,
        // 2026-09-07). Left as plain BUBBLE phase.
        const rightClick = new Gtk.GestureClick({ button: 3 })
        rightClick.connect("pressed", () => {
          if (!net.wifi) return
          net.wifi.enabled = !net.wifi.enabled
          // NetworkManager persists radio state across reboots, so an
          // accidental/test toggle-off would otherwise come back silently
          // disabled next boot (see 04-build-state.md, 2026-09-07).
          if (!net.wifi.enabled) {
            execAsync(["notify-send", "-t", "3000", "Wi-Fi off", "Toggled from the bar (right-click to re-enable)"])
          }
        })
        self.add_controller(rightClick)
      }}
    />
  )
}
