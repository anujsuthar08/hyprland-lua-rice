import { createComputed } from "ags"
import { Gtk } from "ags/gtk4"
import { elapsed, fmtElapsed, recording, stopRecording } from "./recordState"

// A red dot and a running clock that exist ONLY while recording — the
// same "show the deviation, not the steady state" idiom as Mic.tsx. The
// dot doubles as the stop control (the GNOME screencast indicator does
// the same), so a recording you started from a keybind is always one
// click from over.
//
// An always-mounted button toggled with `visible`, never <With> — see
// Mic.tsx / VpnIndicator.tsx for the ordering bug that avoids.
export default function Recording() {
  return (
    <button
      class="glyph rec"
      visible={recording}
      tooltipText="Recording — click to stop"
      onClicked={() => stopRecording()}
    >
      <box spacing={6} valign={Gtk.Align.CENTER}>
        <box class="rec-dot" valign={Gtk.Align.CENTER} />
        <label class="rec-time" label={createComputed([elapsed], (e) => (e < 0 ? "" : fmtElapsed(e)))} />
      </box>
    </button>
  )
}
