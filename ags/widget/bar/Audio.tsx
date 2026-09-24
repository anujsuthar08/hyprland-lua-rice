import { createBinding, createComputed } from "ags"
import { Gtk } from "ags/gtk4"
import AstalWp from "gi://AstalWp?version=0.1"

const MAX_VOLUME = 1.4
const STEP = 0.05

export default function Audio() {
  const speaker = AstalWp.get_default()!.audio.defaultSpeaker

  const volume = createBinding(speaker, "volume")
  const mute = createBinding(speaker, "mute")

  const icon = createComputed([volume, mute], (v, m) => {
    if (m || v < 0.01) return "󰝟"
    if (v < 0.34) return "󰕿"
    if (v < 0.67) return "󰖀"
    return "󰕾"
  })
  const label = createComputed([volume, mute], (v, m) =>
    m ? "muted" : `${Math.round(v * 100)}%`,
  )

  return (
    <button
      class="Audio chip"
      onClicked={() => { speaker.mute = !speaker.mute }}
      $={(self) => {
        // GTK4 has no "scroll" signal on widgets — scrolling is an
        // EventController. (GTK3 examples that use onScroll won't work.)
        const scroll = new Gtk.EventControllerScroll({
          flags: Gtk.EventControllerScrollFlags.VERTICAL,
        })
        scroll.connect("scroll", (_c, _dx, dy) => {
          const next = speaker.volume - dy * STEP
          speaker.volume = Math.max(0, Math.min(MAX_VOLUME, next))
          return true
        })
        self.add_controller(scroll)
      }}
    >
      <box>
        <label class="icon" label={icon} />
        <label label={label} />
      </box>
    </button>
  )
}
