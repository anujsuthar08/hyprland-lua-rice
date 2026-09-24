import { createState } from "ags"
import { pointerOver } from "./pointer"
import { Gtk } from "ags/gtk4"
import { timeout, Timer } from "ags/time"
import Graphene from "gi://Graphene"

// Which dropdown is open, and where it should hang from.
//
// Not a GtkPopover, for a measured reason. A GTK4 popover is its own
// Wayland surface parented to the bar's layer surface, and on
// gtk4-layer-shell 1.3.0 / GTK 4.22.4 it only maps IF IT FITS INSIDE
// THE PARENT — with the window sized to the 30px bar every dropdown
// came back `visible=false, mapped=false`, silently, with the
// menubutton latched to :checked as if it had opened. Growing the bar's
// surface to 480px made them map, but then clamping that surface's
// input region (needed, or the sheet eats every click in the top 480px
// of the desktop) hung the whole shell hard enough to need a kill -9.
//
// So the dropdown is a layer window of its own. It costs a few lines of
// positioning that GTK would have done for us, and in exchange it is
// completely predictable: we choose the size, the placement, the
// animation and the dismissal.
export type DropdownName =
  | "volume"
  | "network"
  | "bandwidth"
  | "bluetooth"
  | "player"
  | "calendar"
  | "notifications"
  | "battery"
  | "weather"
  | "system"
  | "session"
  | "workspace"
  | "phone"

export const [openDropdown, setOpenDropdown] = createState<DropdownName | null>(null)

// Which workspace the "workspace" dropdown should preview. A separate
// piece of state rather than a family of dropdown NAMES (one per
// workspace id) because the panel list in BarDropdown.tsx is built
// once at startup — workspaces open and close all the time, so there
// is no fixed set of names to register ahead of time. One shared panel
// that re-renders off this id does the same job.
export const [hoveredWorkspace, setHoveredWorkspace] = createState<number | null>(null)

// Left edge of the panel, in monitor coordinates.
export const [anchorX, setAnchorX] = createState(0)

// Width the panels are laid out at. The dropdown is positioned, not
// measured, so this has to be stated rather than asked for — a
// measure() before the window is mapped returns the minimum, not what
// the panel will actually take.
export const PANEL_WIDTH = 300

// The glyph that opened the current dropdown (see hoverLeave's guard).
let openAnchor: Gtk.Widget | null = null

// True only while the open dropdown was opened by HOVER (not click or
// keyboard). A hover-opened menu should go away when the pointer leaves;
// a deliberately clicked-open one stays until dismissed. BarDropdown uses
// this to start the close timer for a pointer that wanders off without
// ever entering the panel — after Bar/hoverLeave began ignoring the
// synthetic leave, that real departure emits no event of its own.
let hoverOpened = false
export const isHoverOpened = () => hoverOpened

export function closeDropdown() {
  openAnchor = null
  hoverOpened = false
  setOpenDropdown(null)
}

// ─────────────────────── hover to open ───────────────────────
//
// Menus open on hover, not on click. Three timings make that livable
// rather than twitchy:
//
//   OPEN_DELAY  — pointer has to REST on a glyph. Without it, crossing
//                 the cluster on the way to the clock fires four menus.
//   SWITCH      — once one menu is up, moving to the next glyph swaps
//                 instantly. You are already in the menus; asking you
//                 to wait again would feel broken.
//   CLOSE_GRACE — the pointer has to travel from the glyph, across the
//                 gap, to the panel. Close on leave with no grace and
//                 the menu shuts in the gap, every time.
const OPEN_DELAY = 220
const CLOSE_GRACE = 260

let openTimer: Timer | null = null
let closeTimer: Timer | null = null

// Set when a click CLOSES a menu, so the hover that is still sitting
// on the glyph does not immediately reopen it. Cleared when the
// pointer leaves — clicking to dismiss has to actually dismiss.
let suppressed: DropdownName | null = null

function cancelTimers() {
  openTimer?.cancel()
  openTimer = null
  closeTimer?.cancel()
  closeTimer = null
}

export function hoverEnter(name: DropdownName, widget: Gtk.Widget) {
  closeTimer?.cancel()
  closeTimer = null

  if (suppressed === name) return
  if (openDropdown.peek() === name) return

  openTimer?.cancel()
  // Already showing a menu? Swap without the rest delay.
  const delay = openDropdown.peek() !== null ? 0 : OPEN_DELAY
  openTimer = timeout(delay, () => {
    openTimer = null
    showDropdown(name, widget)
    hoverOpened = true
  })
}

// Set for the lifetime of a drag started from inside a dropdown panel
// (see WorkspacePreview.tsx). While true, `hoverLeave` is a no-op: the
// pointer leaving the panel on its way to a drop target is normal
// drag traffic, not "the user moved away, close this" — and closing
// (or, before this flag existed, letting a DIFFERENT pip's drop-target
// "enter" call setHoveredWorkspace and rebuild the panel's content)
// destroys the very widget the drag is dragging, which cancels the
// drag before it can ever reach "drop". Confirmed by trace: 57
// enter/leave pairs across four pips, zero drops, one final
// `drag-end deleteData=false`, all before this flag was added.
let dragActive = false

export function setDragActive(active: boolean) {
  dragActive = active
  // Resume normal close-on-leave once the drag is over, in case the
  // pointer ended up somewhere that should already have closed this.
  if (!active) hoverLeave()
}

export function hoverLeave() {
  if (dragActive) return

  suppressed = null
  openTimer?.cancel()
  openTimer = null

  closeTimer?.cancel()
  closeTimer = timeout(CLOSE_GRACE, () => {
    closeTimer = null
    // Same reasoning as Bar.tsx: opening a dropdown makes GTK report a
    // leave on the glyph you are still pointing at. Only close if the
    // compositor says the pointer is really off it.
    const anchor = openAnchor
    if (!anchor) return closeDropdown()
    pointerOver(anchor).then((over) => {
      if (!over && closeTimer === null) closeDropdown()
    })
  })
}

/** The panel itself is hovered — whatever close is pending, cancel it. */
export function hoverKeep() {
  closeTimer?.cancel()
  closeTimer = null
}

/** Attaches hover-to-open to a bar glyph. */
export function hoverable(name: DropdownName, widget: Gtk.Widget) {
  const motion = new Gtk.EventControllerMotion()
  motion.connect("enter", () => hoverEnter(name, widget))
  motion.connect("leave", () => hoverLeave())
  widget.add_controller(motion)
}

// Each glyph registers itself so a dropdown can also be opened without
// a pointer — from `ags request "menu network"`, and so from a keybind.
// On a multi-monitor setup the last bar built wins; the dropdown is one
// window per monitor anyway, so the only consequence is which screen an
// unanchored open lands on.
const anchors = new Map<DropdownName, Gtk.Widget>()

export function registerAnchor(name: DropdownName, widget: Gtk.Widget) {
  anchors.set(name, widget)
}

/** Opens `name` centred under `button`. */
export function showDropdown(name: DropdownName, from?: Gtk.Widget) {
  const button = from ?? anchors.get(name)
  openAnchor = button ?? null
  const root = button?.get_root()
  if (button && root) {
    // compute_point, not the deprecated translate_coordinates. The bar
    // window spans the full monitor from x=0, so a point in root
    // coordinates is already a point on the monitor.
    const [ok, p] = button.compute_point(
      root as unknown as Gtk.Widget,
      new Graphene.Point({ x: 0, y: 0 }),
    )
    if (ok) {
      const monitorWidth = root.get_width()
      const centred = p.x + button.get_width() / 2 - PANEL_WIDTH / 2
      const margin = 8
      setAnchorX(
        Math.round(
          Math.max(margin, Math.min(monitorWidth - PANEL_WIDTH - margin, centred)),
        ),
      )
    }
  }

  setOpenDropdown(name)
}

/**
 * Click behaviour: opens if closed, closes if open. With hover-to-open
 * doing most of the work this is mainly the dismissal — and the route
 * in from `ags request menu <name>`, which has no pointer at all.
 */
export function toggleDropdown(name: DropdownName, from?: Gtk.Widget) {
  cancelTimers()
  hoverOpened = false // an explicit click/keypress: stay open until dismissed

  if (openDropdown.peek() === name) {
    suppressed = name
    return closeDropdown()
  }

  showDropdown(name, from)
}
