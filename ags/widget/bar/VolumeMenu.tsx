import { Accessor, createBinding, createComputed, For } from "ags"
import { onSlide } from "./slide"
import { Gtk, Gdk } from "ags/gtk4"
import AstalWp from "gi://AstalWp?version=0.1"
import Menu from "./Menu"
import AppMixer from "./AppMixer"
import { createBrightness, hasBacklight, setBrightness } from "./brightness"
import { brightnessIcon, SELECTED, volumeIcon } from "./icons"

// The dropdown body: the two levels you actually reach for — volume
// and screen brightness — plus an output-device switcher, the thing the
// pre-rebuild bar never had (picking speakers vs headphones meant
// opening pavucontrol).
//
// Brightness lives here rather than behind a glyph of its own because
// it is the same kind of control and never needs to be READ at a
// glance: nobody checks their brightness percentage, they just want the
// slider. One fewer permanent icon on the bar for the same capability.
export function VolumePanel() {
  const audio = AstalWp.get_default()!.audio
  const speaker = audio.defaultSpeaker

  const volume = createBinding(speaker, "volume")
  const mute = createBinding(speaker, "mute")

  // `speakers` is nullable on the Astal side; For needs a real array.
  const speakers = createComputed([createBinding(audio, "speakers")], (l) => l ?? [])

  return (
    <box class="Panel VolumePanel" orientation={Gtk.Orientation.VERTICAL} spacing={10}>
      <box spacing={8}>
        <button class="glyph" onClicked={() => { speaker.mute = !speaker.mute }}>
          <image iconName={createComputed([volume, mute], volumeIcon)} pixelSize={16} />
        </button>

        <slider
          hexpand
          min={0}
          max={1}
          value={createComputed([volume], (v) =>
            isNaN(v) ? 0 : Math.max(0, Math.min(1, v)),
          )}
          onChangeValue={onSlide((v) => { speaker.volume = v })}
        />

        <label
          class="value"
          label={createComputed([volume], (v) => `${Math.round(v * 100)}%`)}
        />
      </box>

      {hasBacklight ? <BrightnessRow /> : <box />}

      <box class="rows" orientation={Gtk.Orientation.VERTICAL} spacing={1}>
        <For each={speakers}>
          {(dev: AstalWp.Endpoint) => (
            <button
              class={createComputed(
                [createBinding(dev, "isDefault")],
                (isDefault) => `row ${isDefault ? "active" : ""}`,
              )}
              onClicked={() => dev.set_is_default(true)}
            >
              <box spacing={8}>
                <image
                  class="tick"
                  iconName={SELECTED}
                  pixelSize={14}
                  visible={createBinding(dev, "isDefault")}
                />
                <label
                  xalign={0}
                  hexpand
                  label={createBinding(dev, "description")((d: string) =>
                    d && d.length > 34 ? `${d.slice(0, 33)}…` : (d ?? ""),
                  )}
                />
              </box>
            </button>
          )}
        </For>
      </box>

      <AppMixer />
    </box>
  )
}

function BrightnessRow() {
  const level = createBrightness()

  return (
    <box spacing={8}>
      <image
        class="glyph-static"
        iconName={createComputed([level], brightnessIcon)}
        pixelSize={16}
      />

      <slider
        hexpand
        min={0}
        max={1}
        value={createComputed([level], (v) => Math.max(0, Math.min(1, v)))}
        onChangeValue={onSlide((v) => setBrightness(v))}
      />

      <label
        class="value"
        label={createComputed([level], (v) => `${Math.round(v * 100)}%`)}
      />
    </box>
  )
}

export default function VolumeMenu(props: { reveal: Accessor<boolean> }) {
  const speaker = AstalWp.get_default()!.audio.defaultSpeaker

  const volume = createBinding(speaker, "volume")
  const mute = createBinding(speaker, "mute")

  return (
    <Menu
      name="volume"
      icon={createComputed([volume, mute], volumeIcon)}
      value={createComputed([volume, mute], (v, m) =>
        m ? "muted" : `${Math.round(v * 100)}%`,
      )}
      reveal={props.reveal}
      tooltip="Scroll to adjust · right-click to mute · click for outputs"
      setup={(self) => {
        // Scroll-over-volume, which the pre-rebuild archeclipse bar had
        // and the 2026-09-01 rebuild dropped. 2% a notch: fine enough
        // to land on a value, coarse enough to cross the range.
        const scroll = new Gtk.EventControllerScroll(
          { flags: Gtk.EventControllerScrollFlags.VERTICAL },
        )
        scroll.connect("scroll", (_c, _dx, dy) => {
          const next = speaker.volume - Math.sign(dy) * 0.02
          speaker.volume = Math.max(0, Math.min(1, next))
          return Gdk.EVENT_STOP
        })
        self.add_controller(scroll)

        // Right-click mutes without opening the dropdown — the common
        // action the compact glyph should just DO (09-bar-interaction-
        // research.md, item 5). `button: 3` scopes the gesture to right
        // clicks only, so it never fights the glyph's own left-click
        // (wired separately, via `onClicked`, to open the dropdown).
        //
        // Measured unreliable under synthetic (ydotool) clicks only — see
        // 04-build-state.md, 2026-09-07: raw button-3 delivery to this
        // surface is 100% reliable (confirmed via wev), but this handler
        // only fired on roughly 1 synthetic click in 15. Explicitly
        // setting PropagationPhase.CAPTURE was tried and measured WORSE
        // (0/20) — reverted. Confirmed 2026-09-22: fine on a real mouse
        // in daily use, so this was purely a synthetic-input artifact —
        // nothing to fix here.
        const rightClick = new Gtk.GestureClick({ button: 3 })
        rightClick.connect("pressed", () => { speaker.mute = !speaker.mute })
        self.add_controller(rightClick)
      }}
    />
  )
}
