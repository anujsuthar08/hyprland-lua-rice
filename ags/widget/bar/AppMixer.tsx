import { createBinding, createComputed, For } from "ags"
import { Gtk } from "ags/gtk4"
import AstalWp from "gi://AstalWp?version=0.1"
import { onSlide } from "./slide"
import { volumeIcon } from "./icons"

// Per-application volume: one slider per playing stream, so a loud video can be turned
// down without touching the speakers (and pavucontrol is no longer needed for it).
// Pattern follows KDE Plasma's Audio Volume applet: applications listed under the
// device controls, each with its own mute and level. The block only exists while
// something is actually playing — an empty "Applications" heading is noise.
export default function AppMixer() {
  const audio = AstalWp.get_default()!.audio
  const streams = createComputed([createBinding(audio, "streams")], (l) => l ?? [])

  return (
    <box class="AppMixer" orientation={Gtk.Orientation.VERTICAL} spacing={6} visible={createComputed([streams], (l) => l.length > 0)}>
      <label class="dim" xalign={0} label="Applications" />
      <For each={streams}>
        {(s: AstalWp.Stream) => {
          const volume = createBinding(s, "volume")
          const mute = createBinding(s, "mute")
          // application.name is the app ("Brave", "Spotify"); Stream.name is the per-stream
          // media title, which for some players is a file path
          const title = createComputed([createBinding(s, "name"), createBinding(s, "description")], (n, d) =>
            s.get_pw_property("application.name") || d || n || "Application")
          return (
            <box class="app-row" orientation={Gtk.Orientation.VERTICAL} spacing={2}>
              <box spacing={8}>
                <button
                  class={createComputed([mute], (m) => `icon-btn ${m ? "muted" : ""}`)}
                  tooltipText="Mute this app"
                  onClicked={() => { s.mute = !s.mute }}
                >
                  <image iconName={createComputed([volume, mute], volumeIcon)} pixelSize={14} />
                </button>
                <label class="status" xalign={0} hexpand ellipsize={3} maxWidthChars={24} label={title} />
                <label class="value" label={createComputed([volume, mute], (v, m) => (m ? "muted" : `${Math.round(v * 100)}%`))} />
              </box>
              <slider
                hexpand
                min={0}
                max={1}
                value={createComputed([volume], (v) => (isNaN(v) ? 0 : Math.max(0, Math.min(1, v))))}
                onChangeValue={onSlide((v) => { s.volume = v })}
              />
            </box>
          )
        }}
      </For>
    </box>
  )
}
