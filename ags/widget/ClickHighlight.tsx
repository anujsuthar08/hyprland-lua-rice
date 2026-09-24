import app from "ags/gtk4/app"
import { Astal, Gdk, Gtk } from "ags/gtk4"
import { createComputed } from "ags"
import Gtk4LayerShell from "gi://Gtk4LayerShell?version=1.0"
import cairo from "gi://cairo"
import { highlightActive, lastClick } from "./bar/clickHighlightState"

const RIPPLE = 56 // px, matches .click-ripple's sizing in main.scss

// Cursor click highlighter overlay — see clickHighlightState.ts.
//
// ⚠️ Went through a full-screen version first (one window per monitor
// covering the whole output, ripple positioned inside via margin, an
// EMPTY `set_input_region` on "realize" meant to make it click-through
// everywhere). That DID NOT WORK: verified live that it silently ate
// every click on the entire desktop, full stop — the empty region never
// actually took effect (wrong signal for a layer-shell surface's real
// readiness, or gtk4-layer-shell just doesn't honour it the way plain
// GTK4/Wayland does; not chased further). Caught only by a proper
// isolation test (temporarily unmounting the window entirely and
// confirming the calendar panel opened again) — an earlier A/B test
// toggling the DAEMON on/off looked clean but was worthless, because the
// window itself was always mapped regardless of daemon state.
//
// This version is safe BY CONSTRUCTION instead of by a region call that
// has to be trusted: the window is tiny (RIPPLE×RIPPLE, not full-screen)
// and INVISIBLE except for the ~500ms the ripple actually plays
// (`visible={highlightActive}`), repositioned to the click point via
// `Gtk4LayerShell.set_margin` each time. Worst case if it ever did
// capture a click, the blast radius is one 56px square for half a
// second, not the entire screen forever.
export default function ClickHighlight(gdkmonitor: Gdk.Monitor) {
  const { TOP, LEFT } = Astal.WindowAnchor
  const geo = gdkmonitor.get_geometry()

  return (
    <window
      visible={highlightActive}
      name="click-highlight"
      namespace="click-highlight"
      class="ClickHighlight hypr-shell"
      gdkmonitor={gdkmonitor}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.NONE}
      anchor={TOP | LEFT}
      application={app}
      $={(self: Gtk.Window) => {
        // Defence in depth on top of the size/visibility containment
        // above, not instead of it — same call as the full-screen
        // attempt, kept because an empty region is still the semantically
        // correct thing to ask for even though it wasn't trustworthy
        // alone.
        self.connect("map", () => {
          self.get_surface()?.set_input_region(new cairo.Region())
        })

        lastClick.subscribe(() => {
          const c = lastClick.get()
          if (!c) return
          Gtk4LayerShell.set_margin(self, Gtk4LayerShell.Edge.LEFT, Math.max(0, c.x - geo.x - RIPPLE / 2))
          Gtk4LayerShell.set_margin(self, Gtk4LayerShell.Edge.TOP, Math.max(0, c.y - geo.y - RIPPLE / 2))
        })
      }}
    >
      <box class={createComputed([highlightActive], (a) => (a ? "click-ripple active" : "click-ripple"))} />
    </window>
  )
}
