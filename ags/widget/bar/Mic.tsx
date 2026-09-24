import { createBinding } from "ags"
import { Gtk } from "ags/gtk4"
import AstalWp from "gi://AstalWp?version=0.1"
import { MIC_MUTED } from "./icons"

// A microphone glyph that exists ONLY while the mic is muted.
//
// The useful fact about a microphone is not that you have one — it is
// that you are talking into a muted one. So there is no permanent
// indicator here: the glyph appears when the mic is muted and is gone
// the rest of the time, which costs nothing at rest and is impossible
// to miss during a call. Click to unmute.
//
// An always-mounted button with `visible` toggled, NOT <With> swapping
// between a button and an empty box — found via VpnIndicator.tsx
// (04-build-state.md, 2026-09-06): gnim's GTK4 bridge turns a Fragment's
// post-mount "append" into a plain `Gtk.Box.append(child)`, which has
// no concept of "put it back where it was" and lands the new child at
// the END of the cluster the first time `mute` flips. Never actually
// observed here (this bar has never run through a real mute/unmute
// cycle to trigger it), but it's the exact same pattern that reproduced
// the bug — same fix applies.
export default function Mic() {
  const mic = AstalWp.get_default()?.audio?.defaultMicrophone
  if (!mic) return <box />

  const mute = createBinding(mic, "mute")

  return (
    <button
      class="glyph mic-muted"
      visible={mute}
      tooltipText="Microphone muted — click to unmute"
      onClicked={() => { mic.mute = false }}
    >
      <image class="icon" iconName={MIC_MUTED} pixelSize={18} valign={Gtk.Align.CENTER} />
    </button>
  )
}
