import { createBinding, createComputed, With } from "ags"
import AstalNetwork from "gi://AstalNetwork?version=0.1"

export default function Network() {
  const net = AstalNetwork.get_default()
  const primary = createBinding(net, "primary")
  const wifi = createBinding(net, "wifi")
  const connectivity = createBinding(net, "connectivity")

  return (
    <box class="Network chip">
      <With value={createComputed([primary, wifi], (p, w) => ({ p, w }))}>
        {({ p, w }) => {
          // wired takes precedence; wifi may be null on desktops
          if (p === AstalNetwork.Primary.WIRED) {
            return <label label="󰈀" />
          }
          if (!w) return <label label="󰤭" />

          const strength = createBinding(w, "strength")
          const ssid = createBinding(w, "ssid")
          // Association (strength/ssid) and actual internet reachability
          // (connectivity, from NM's periodic check) are independent: an
          // AP that just powered off leaves the radio "associated" for a
          // while (no clean deauth on power loss), so trusting strength
          // alone shows a healthy icon over a dead link. Once NM's check
          // catches up and reports anything short of FULL, show that
          // instead of a strength bar that's lying.
          const icon = createComputed([strength, connectivity], (s, c) => {
            if (s < 0) return "󰤭"
            if (
              c === AstalNetwork.Connectivity.NONE ||
              c === AstalNetwork.Connectivity.PORTAL ||
              c === AstalNetwork.Connectivity.LIMITED
            )
              return "󰤮"
            if (s < 25) return "󰤟"
            if (s < 50) return "󰤢"
            if (s < 75) return "󰤥"
            return "󰤨"
          })
          return (
            <box>
              <label class="icon" label={icon} />
              <label label={createComputed([ssid], (s) => s ?? "")} />
            </box>
          )
        }}
      </With>
    </box>
  )
}
