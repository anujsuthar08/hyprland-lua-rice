import { Gtk } from "ags/gtk4"
import { currentActivity } from "./activityState"

// Shown only while an activity is active (same idiom as Caffeine/
// Nightlight/Mic/Recording — the deviation, not the steady state).
// Passive: switching happens from SUPER+P (1-4 to switch, w/h/r/s to
// open a workshop, which also switches) — this is just "which one, if
// any" at a glance.
export default function Activity() {
  return (
    <box
      class="glyph activity"
      visible={currentActivity.as((a) => a !== null)}
      tooltipText={currentActivity.as((a) =>
        a ? `Activity: ${a} — other workshops' windows are hidden · SUPER+P to switch` : "",
      )}
    >
      <box class="glyph-body" spacing={5} valign={Gtk.Align.CENTER}>
        <image class="icon" iconName="bar-activity" pixelSize={18} valign={Gtk.Align.CENTER} />
        <label class="value" label={currentActivity.as((a) => a ?? "")} valign={Gtk.Align.CENTER} />
      </box>
    </box>
  )
}
