import { Gtk } from "ags/gtk4"
import { active, cycleNightLight, nightStatus } from "./nightState"
import { createComputed } from "ags"

// A moon that exists ONLY while the filter is actually on — same
// "show the deviation, not the steady state" idiom as Mic.tsx and
// Recording.tsx (an always-mounted button toggled with `visible`, never
// <With>). Click cycles the mode.
export default function Nightlight() {
  return (
    <button
      class="glyph nightlight"
      visible={active}
      tooltipText={createComputed([nightStatus], (s) => `Night light — ${s} · click to change`)}
      onClicked={() => cycleNightLight()}
    >
      <image class="icon" iconName="bar-moon" pixelSize={18} valign={Gtk.Align.CENTER} />
    </button>
  )
}
