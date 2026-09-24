import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"
import { timerActive, timerClass, timerText, timerTip } from "./timerState"

// The running timer, only while there is one (same idiom as Recording/Nightlight):
// an icon and the countdown. Click opens the Timer launcher tab, where it can be stopped.
export default function Timer() {
  return (
    <button
      class={timerClass}
      visible={timerActive}
      tooltipText={timerTip}
      onClicked={() => execAsync(["rofi", "-show", "timer"]).catch(() => {})}
    >
      <box class="glyph-body" spacing={5} valign={Gtk.Align.CENTER}>
        <image class="icon" iconName="bar-timer" pixelSize={18} valign={Gtk.Align.CENTER} />
        <label class="value timer-text" label={timerText} valign={Gtk.Align.CENTER} />
      </box>
    </button>
  )
}
