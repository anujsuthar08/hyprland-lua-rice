import { Accessor, createComputed } from "ags"
import { Gtk } from "ags/gtk4"
import Menu from "./Menu"
import { batteryIcon } from "./icons"
import {
  browsePhone,
  phoneBattery,
  phoneDevice,
  phoneServiceAvailable,
  pingPhone,
  ringPhone,
  unpairPhone,
} from "./valentState"

// Phone integration (Valent — see valentState.ts for the protocol notes
// and why it's Valent and not the official `kdeconnect` package). Whole
// panel is `visible={phoneServiceAvailable}` at the glyph, same pattern
// as the power-profile tile: an optional AUR package, so the UI doesn't
// exist at all on a machine that never installed it — see
// packages/optional.txt.

function Action(props: { icon: string; label: string; onClicked: () => void }) {
  return (
    <button class="action" tooltipText={props.label} onClicked={props.onClicked}>
      <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
        <image class="icon" iconName={props.icon} pixelSize={18} halign={Gtk.Align.CENTER} />
        <label label={props.label} />
      </box>
    </button>
  )
}

export function PhonePanel() {
  return (
    <box class="Panel PhonePanel" orientation={Gtk.Orientation.VERTICAL} spacing={10}>
      <box class="panel-head">
        <label class="panel-title" label="Phone" xalign={0} hexpand />
        <label class="dim" label={createComputed([phoneDevice], (d) => d?.name ?? "")} />
      </box>

      {/* Valent running, nothing paired yet. */}
      <label
        class="dim"
        xalign={0}
        wrap
        label='No phone paired. Install KDE Connect on your phone, open it on the
          same Wi-Fi network, and tap "arch-guardian".'
        visible={createComputed([phoneDevice], (d) => !d)}
      />

      {/* Paired but not currently reachable (phone off Wi-Fi, asleep, …). */}
      <label
        class="dim"
        xalign={0}
        label={createComputed([phoneDevice], (d) => (d && d.paired && !d.connected ? "Not connected" : ""))}
      />

      {/* Connected and paired: battery + actions. */}
      <box
        orientation={Gtk.Orientation.VERTICAL}
        spacing={10}
        visible={createComputed([phoneDevice], (d) => !!d && d.paired && d.connected)}
      >
        <box
          class="phone-battery"
          spacing={8}
          visible={createComputed([phoneBattery], (b) => !!b)}
        >
          <image
            iconName={createComputed([phoneBattery], (b) => (b ? batteryIcon(b.percentage / 100, b.charging) : ""))}
            pixelSize={18}
          />
          <label
            xalign={0}
            hexpand
            label={createComputed([phoneBattery], (b) => (b ? `${Math.round(b.percentage)}%` : ""))}
          />
          <label
            class="dim"
            label={createComputed([phoneBattery], (b) => (b?.charging ? "charging" : ""))}
          />
        </box>

        <box class="actions" spacing={4} homogeneous>
          <Action icon="find-location-symbolic" label="Ring" onClicked={ringPhone} />
          <Action icon="network-transmit-receive-symbolic" label="Ping" onClicked={() => pingPhone()} />
          <Action icon="folder-remote-symbolic" label="Browse" onClicked={browsePhone} />
          <Action icon="edit-delete-symbolic" label="Unpair" onClicked={unpairPhone} />
        </box>
      </box>
    </box>
  )
}

export default function PhoneMenu(props: { reveal: Accessor<boolean> }) {
  return (
    <Menu
      name="phone"
      icon="phone-symbolic"
      value={createComputed([phoneDevice], (d) => d?.name ?? "")}
      reveal={props.reveal}
      tooltip="Phone"
      extra={createComputed(
        [phoneDevice],
        (d) => (d && d.paired && !d.connected ? "dim" : ""),
      )}
      visible={phoneServiceAvailable}
    />
  )
}
