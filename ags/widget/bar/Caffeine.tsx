import { Gtk } from "ags/gtk4"
import { caffeine, toggleCaffeine } from "./caffeineState"

// Shown only while caffeine is on (the deviation, not the steady state — same
// idiom as Nightlight/Mic/Recording). Click turns it off.
export default function Caffeine() {
  return (
    <button
      class="glyph caffeine"
      visible={caffeine}
      tooltipText="Caffeine on — the screen will not dim or lock · click to turn off"
      onClicked={() => toggleCaffeine()}
    >
      <image class="icon" iconName="bar-coffee" pixelSize={18} valign={Gtk.Align.CENTER} />
    </button>
  )
}
