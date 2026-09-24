import { Accessor, createComputed, createState } from "ags"
import { Gtk } from "ags/gtk4"
import { createSubprocess, execAsync } from "ags/process"
import { interval } from "ags/time"
import Menu from "./Menu"
import { BANDWIDTH, REFRESH } from "./icons"
import { BANDWIDTH_BIN } from "./bandwidth"

// [uploadRate, downloadRate, uploadToday, downloadToday, localIp,
// iface, isVpn], rate in bytes/sec, totals in bytes — exactly what
// scripts/bandwidth-loop.c prints as one JSON array per line, every 3s.
// The interface it reads is re-resolved every tick on the C side, so
// localIp/iface/isVpn all already track whichever interface currently
// holds the default route — a VPN tunnel included, the moment it takes
// over routing. isVpn is 0/1: whether that interface has NO
// `/sys/class/net/<iface>/device` backing it (see the C file's header
// for why that beats matching interface-name prefixes).
//
// Exported: VpnIndicator.tsx (a separate glyph in Bar.tsx) reads isVpn
// off this same accessor rather than spawning its own — see below,
// same reasoning as BandwidthMenu/BandwidthPanel sharing it: only one
// process may read scripts/bandwidth-loop.c's stdout / write its log
// file at a time.
export const stats = createSubprocess<
  [number, number, number, number, string, string, number]
>([0, 0, 0, 0, "", "", 0], [BANDWIDTH_BIN], (out, prev) => {
  try {
    const parsed = JSON.parse(out)
    if (!Array.isArray(parsed) || parsed.length !== 7) return prev
    return parsed as [number, number, number, number, string, string, number]
  } catch {
    return prev
  }
})

// The LOCAL address (above) is what this machine calls itself on
// whatever interface has the route — a VPN's tunnel address included,
// but still not what a remote server sees you connect FROM. That's a
// separate lookup: an external echo service, queried straight off this
// machine's current route, so it reflects the VPN's real exit IP once
// one is up. Module scope for the same reason as `stats` — one shared
// poll, not one per mounted widget.
const PUBLIC_IP_POLL_MS = 20_000
const [publicIp, setPublicIp] = createState("…")

function refreshPublicIp() {
  execAsync(["curl", "-s", "--max-time", "4", "https://api.ipify.org"])
    .then((out) => {
      const ip = out.trim()
      // Anything other than a clean dotted-quad (a timeout, a proxy
      // error page, empty output) is discarded — better to keep
      // showing the last known-good IP than flash something bogus.
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) setPublicIp(ip)
    })
    .catch(() => {})
}

interval(PUBLIC_IP_POLL_MS, refreshPublicIp)

function formatRate(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec < 1) return "0 KB/s"
  const kb = bytesPerSec / 1024
  return kb < 1024 ? `${kb.toFixed(0)} KB/s` : `${(kb / 1024).toFixed(1)} MB/s`
}

function formatTotal(bytes: number): string {
  if (!bytes) return "0 KB"
  const units = ["KB", "MB", "GB", "TB"]
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(2)} ${units[i]}`
}

export function BandwidthPanel() {
  return (
    <box class="Panel BandwidthPanel" orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      <box class="panel-head">
        <label class="panel-title" label="Network Usage" xalign={0} hexpand />
        <button
          class="chip"
          tooltipMarkup="Refresh public IP"
          onClicked={() => refreshPublicIp()}
        >
          <image iconName={REFRESH} pixelSize={13} />
        </button>
      </box>

      <box spacing={16}>
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand>
          <label class="dim" label="Upload" xalign={0} />
          <label
            class="status"
            xalign={0}
            label={createComputed([stats], (s) => formatRate(s[0]))}
          />
          <label
            class="dim"
            xalign={0}
            label={createComputed([stats], (s) => `${formatTotal(s[2])} today`)}
          />
        </box>

        <box orientation={Gtk.Orientation.VERTICAL} spacing={2} hexpand>
          <label class="dim" label="Download" xalign={0} />
          <label
            class="status"
            xalign={0}
            label={createComputed([stats], (s) => formatRate(s[1]))}
          />
          <label
            class="dim"
            xalign={0}
            label={createComputed([stats], (s) => `${formatTotal(s[3])} today`)}
          />
        </box>
      </box>

      <box orientation={Gtk.Orientation.VERTICAL} spacing={4} class="bandwidth-ip">
        <box spacing={8}>
          <label class="dim" label="Local IP" xalign={0} widthRequest={90} />
          <label
            class="status"
            xalign={0}
            hexpand
            label={createComputed([stats], (s) => s[4] || "—")}
          />
        </box>
        <box spacing={8}>
          <label class="dim" label="Public IP" xalign={0} widthRequest={90} />
          <label class="status" xalign={0} hexpand label={publicIp} />
        </box>
        <box spacing={8}>
          <label class="dim" label="Route" xalign={0} widthRequest={90} />
          <label
            class="status"
            xalign={0}
            hexpand
            label={createComputed([stats], (s) =>
              s[6] ? `VPN (${s[5] || "unknown"})` : s[5] ? `Direct (${s[5]})` : "—",
            )}
          />
        </box>
      </box>
    </box>
  )
}

export default function BandwidthMenu(props: { reveal: Accessor<boolean> }) {
  const value = createComputed(
    [stats],
    (s) => `${formatRate(s[1])} ↓ ${formatRate(s[0])} ↑`,
  )

  return (
    <Menu
      name="bandwidth"
      icon={BANDWIDTH}
      value={value}
      reveal={props.reveal}
      tooltip="Network usage"
    />
  )
}
