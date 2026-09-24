import { createBinding, createComputed } from "ags"
import AstalBluetooth from "gi://AstalBluetooth?version=0.1"

export default function Bluetooth() {
  const bt = AstalBluetooth.get_default()

  const powered = createBinding(bt, "isPowered")
  const connected = createBinding(bt, "isConnected")

  const icon = createComputed([powered, connected], (p, c) =>
    !p ? "󰂲" : c ? "󰂱" : "󰂯",
  )

  return (
    <box class="Bluetooth chip">
      <label class="icon" label={icon} />
    </box>
  )
}
