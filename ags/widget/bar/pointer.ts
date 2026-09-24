import { execAsync } from "ags/process"
import { Gdk, Gtk } from "ags/gtk4"

// Is the pointer physically over `widget`? Answered by the COMPOSITOR
// (`hyprctl cursorpos`), not by GTK.
//
// GTK's own answers are not reliable at the moments that matter. When a
// dropdown window maps or the bar resizes under a resting pointer, GTK
// reports a `leave` and GDK's `get_device_position` says the pointer is
// not over the surface — while the pointer has not moved at all. Acting on
// that made the hover-preview loop forever: bar expands -> dropdown opens
// -> synthetic leave -> dropdown closes -> bar collapses -> pointer is
// "entering" again -> repeat, ~730ms per cycle, for as long as the
// pointer rested on an item (04-build-state.md, 2026-09-21).
//
// Coordinates: `cursorpos` is in logical layout pixels, the same space as
// GdkMonitor geometry, so no scale factor is needed.
export async function pointerOver(widget: Gtk.Widget): Promise<boolean> {
  try {
    const root = widget.get_root() as Gtk.Window | null
    const surface = root?.get_surface()
    const display = Gdk.Display.get_default()
    if (!root || !surface || !display) return false

    const [ok, rect] = widget.compute_bounds(root)
    if (!ok) return false
    const mon = display.get_monitor_at_surface(surface)
    if (!mon) return false
    const g = mon.get_geometry()

    const out = await execAsync(["hyprctl", "cursorpos"]) // "1300, 15"
    const [px, py] = out.split(",").map((v) => Number(v.trim()))
    if (!Number.isFinite(px) || !Number.isFinite(py)) return false

    const x0 = g.x + rect.get_x()
    const y0 = g.y + rect.get_y()
    return px >= x0 && px <= x0 + rect.get_width() && py >= y0 && py <= y0 + rect.get_height()
  } catch {
    // if we cannot tell, fall back to the old behaviour (collapse/close)
    return false
  }
}
