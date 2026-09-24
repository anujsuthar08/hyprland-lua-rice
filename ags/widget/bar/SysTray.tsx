import { createBinding, createComputed, For } from "ags"
import { Gtk } from "ags/gtk4"
import AstalTray from "gi://AstalTray?version=0.1"

export default function SysTray() {
  const tray = AstalTray.get_default()
  const items = createBinding(tray, "items")

  // `.SysTray`'s padding is only meaningful once there is a tray icon
  // to pad around — with zero items the class still reserved 4px of
  // dead space, which showed up as one gap in the cluster being wider
  // than every other, tray-empty being the common case on this host.
  const klass = createComputed([items], (l) => ((l ?? []).length > 0 ? "SysTray" : ""))

  return (
    <box class={klass}>
      <For each={items}>
        {(item) => (
          <menubutton
            tooltipMarkup={createBinding(item, "tooltipMarkup")}
            $={(self) => {
              // wire the app's own menu into the popover
              self.insert_action_group("dbusmenu", item.actionGroup)
              self.set_menu_model(item.menuModel)
            }}
          >
            <image gicon={createBinding(item, "gicon")} />
          </menubutton>
        )}
      </For>
    </box>
  )
}
