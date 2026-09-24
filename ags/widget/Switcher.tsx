import app from "ags/gtk4/app"
import { Astal, Gtk } from "ags/gtk4"
import { createComputed, For } from "ags"
import { iconFor } from "./bar/appIcon"
import { items, open, selected, Win } from "./switcherState"

// Alt-Tab overlay. A centred row of cards (app icon, title, workspace), most recently used
// first, the selected one ringed in the accent colour. Cards, not live thumbnails: Wayland has
// no cheap per-window capture here, and a screenshot of the composed screen would show whatever
// overlaps the window. The window takes no keyboard focus, so the app you are leaving keeps it.
// State and stepping live in switcherState.ts; conf/binds.lua drives it.

const MAX_CARDS = 9 // a longer list scrolls: the visible slice follows the selection

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export default function Switcher() {
  const slice = createComputed([items, selected], (all, sel) => {
    const start = Math.max(0, Math.min(sel - Math.floor(MAX_CARDS / 2), all.length - MAX_CARDS))
    return all.slice(start, start + MAX_CARDS).map((w, i) => ({ w, on: start + i === sel }))
  })
  const more = createComputed([items], (all) => (all.length > MAX_CARDS ? `${all.length} windows` : ""))

  return (
    <window
      name="switcher"
      namespace="switcher"
      class="Switcher hypr-shell"
      visible={open}
      layer={Astal.Layer.OVERLAY}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.NONE}
      application={app}
    >
      <box class="switch-panel" orientation={Gtk.Orientation.VERTICAL} spacing={8}>
        <box class="switch-row" spacing={8}>
          <For each={slice}>
            {(c: { w: Win; on: boolean }) => (
              <box class={c.on ? "switch-card on" : "switch-card"} orientation={Gtk.Orientation.VERTICAL} spacing={6}>
                <image iconName={iconFor(c.w.cls)} pixelSize={48} halign={Gtk.Align.CENTER} />
                <label class="switch-title" label={clip(c.w.title, 22)} />
                <label class="dim switch-ws" label={c.w.special ? "scratchpad" : `workspace ${c.w.workspace}`} />
              </box>
            )}
          </For>
        </box>
        <label class="dim" label={more} visible={createComputed([more], (m) => m !== "")} />
      </box>
    </window>
  )
}
