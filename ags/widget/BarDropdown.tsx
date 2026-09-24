import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createComputed, createState } from "ags"
import { timeout, Timer } from "ags/time"
import Graphene from "gi://Graphene"

import { VolumePanel } from "./bar/VolumeMenu"
import { NetworkPanel } from "./bar/NetworkMenu"
import { BandwidthPanel } from "./bar/BandwidthMenu"
import { BluetoothPanel } from "./bar/BluetoothMenu"
import { PhonePanel } from "./bar/PhoneMenu"
import { PlayerPanel } from "./bar/PlayerMenu"
import { NotificationPanel } from "./bar/NotificationMenu"
import { SessionPanel } from "./bar/SessionMenu"
import { BatteryPanel } from "./bar/Battery"
import { WeatherPanel } from "./bar/WeatherMenu"
import { CalendarPanel } from "./bar/CalendarMenu"
import { SystemPanel } from "./bar/SystemMenu"
import WorkspacePreview from "./bar/WorkspacePreview"
import {
  anchorX,
  closeDropdown,
  DropdownName,
  hoverKeep,
  hoverLeave,
  isHoverOpened,
  openDropdown,
  PANEL_WIDTH,
} from "./bar/dropdown"

// The bar's dropdowns, as one layer window rather than four popovers.
// dropdown.ts explains why; this file is what that decision costs.
//
// The window covers the whole monitor and is transparent apart from the
// panel. That is deliberate and it is what a menu is: while one is
// open it takes the screen, and a click anywhere that is not the panel
// dismisses it. Doing it this way means dismissal, keyboard escape and
// the open animation are all ours, and none of them depend on
// gtk4-layer-shell's popup path.

// Must match Bar.tsx's BAR_HEIGHT. The window itself is shifted down by
// this via marginTop (a real layer-shell surface margin, not CSS) — see
// the window below for why that has to be the window and not just the
// panel's own offset.
const BAR_HEIGHT = 38

// Air between the bar strip and the panel, inside the (already-shifted)
// window.
const TOP_OFFSET = 4

// Must match the panel's exit transition in main.scss, or the window
// unmaps mid-animation and the panel vanishes instead of leaving.
const EXIT_MS = 170

// Whether (x, y) — in `root`'s own coordinate space — falls inside
// `widget`'s CURRENT allocation. `compute_point` (not the deprecated
// translate_coordinates) puts widget's local origin into root's space;
// from there it's just a bounds check against its live width/height.
function pointInWidget(widget: Gtk.Widget, root: Gtk.Widget, x: number, y: number): boolean {
  const [ok, p] = widget.compute_point(root, new Graphene.Point({ x: 0, y: 0 }))
  if (!ok) return false
  return x >= p.x && x <= p.x + widget.get_width() && y >= p.y && y <= p.y + widget.get_height()
}

export default function BarDropdown(gdkmonitor: Gdk.Monitor) {
  const { TOP, BOTTOM, LEFT, RIGHT } = Astal.WindowAnchor

  // Two states, not one, so the panel can animate BOTH ways.
  //
  // `mounted` is whether the layer window exists; `shown` is whether
  // the panel is in its resting position. Opening mounts first and
  // adds `shown` a frame later, so the CSS transition has a start
  // state to leave from. Closing drops `shown` immediately and keeps
  // the window alive for the length of the animation — bind the window
  // straight to `openDropdown` and it unmaps on the same frame, which
  // is why the old revealer's exit transition was never once visible.
  const [mounted, setMounted] = createState(false)
  const [shown, setShown] = createState(false)

  // Set once by the panel box's own $= below; read by the window-level
  // motion handler, which is attached before that box exists in a
  // strict top-down sense but runs after it in practice (children are
  // built before a parent element's own `$=` fires).
  let panelWidget: Gtk.Widget | null = null

  // Edge-triggered, like the crossing signals it replaces: only close on
  // an actual inside→outside transition. Without this, a dropdown
  // opened via keybind (cursor resting wherever it already was, often
  // nowhere near the panel) would read as "outside" on the very first
  // motion tick and close itself within one grace period — nothing
  // like a real leave, just the pointer having never been inside yet.
  let wasInside = false

  // GTK4 re-picks hit-testing on every size-allocate and re-emits
  // `motion` at the SAME (x, y) when it does — confirmed by tracing:
  // `x=1220 y=193 inside=true` immediately followed by another
  // `x=1220 y=193 inside=false` with no pointer movement between them,
  // right as NetworkPanel's manual-entry form collapsed after a
  // successful connect. So `motion` alone isn't "genuine hardware
  // movement" after all — only a change in (x, y) is. Coordinates
  // repeated from the last processed event are skipped entirely.
  let lastX: number | null = null
  let lastY: number | null = null

  let pending: Timer | null = null

  openDropdown.subscribe(() => {
    pending?.cancel()
    pending = null

    if (openDropdown.get() !== null) {
      setMounted(true)
      pending = timeout(16, () => {
        pending = null
        setShown(true)
      })
    } else {
      setShown(false)
      pending = timeout(EXIT_MS, () => {
        pending = null
        setMounted(false)
      })
    }
  })

  const panelClass = createComputed([shown], (v) => (v ? "Dropdown shown" : "Dropdown"))

  // The stack keeps every panel alive across opens, so a Wi-Fi scan or
  // a half-typed password survives closing the menu and coming back.
  const stack = (
    <stack
      transitionType={Gtk.StackTransitionType.CROSSFADE}
      transitionDuration={140}
      hhomogeneous={false}
      vhomogeneous={false}
      $={(self: Gtk.Stack) => {
        self.add_named(VolumePanel() as Gtk.Widget, "volume")
        self.add_named(NetworkPanel() as Gtk.Widget, "network")
        self.add_named(BandwidthPanel() as Gtk.Widget, "bandwidth")
        self.add_named(BluetoothPanel() as Gtk.Widget, "bluetooth")
        self.add_named(PhonePanel() as Gtk.Widget, "phone")
        self.add_named(PlayerPanel() as Gtk.Widget, "player")
        self.add_named(CalendarPanel() as Gtk.Widget, "calendar")
        self.add_named(NotificationPanel() as Gtk.Widget, "notifications")
        self.add_named(BatteryPanel() as Gtk.Widget, "battery")
        self.add_named(WeatherPanel() as Gtk.Widget, "weather")
        self.add_named(SystemPanel() as Gtk.Widget, "system")
        self.add_named(SessionPanel() as Gtk.Widget, "session")
        self.add_named(WorkspacePreview() as Gtk.Widget, "workspace")

        // Driven by subscription rather than a visibleChildName prop:
        // that prop is applied at construction, before these children
        // exist, and GTK logs "Child name not found" and shows nothing
        // until the first change.
        const apply = () => {
          const name = openDropdown.get()
          if (name) self.set_visible_child_name(name as DropdownName)
        }
        apply()
        openDropdown.subscribe(apply)
      }}
    />
  ) as Gtk.Widget

  return (
    <window
      name="bar-dropdown"
      // Same namespace as the bar so conf/rules.lua's blur rule covers
      // it without a second rule to keep in step.
      namespace="bar"
      class="BarDropdown hypr-shell"
      gdkmonitor={gdkmonitor}
      visible={mounted}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.ON_DEMAND}
      anchor={TOP | BOTTOM | LEFT | RIGHT}
      // A real layer-shell margin on the WINDOW, not CSS on the panel.
      // Without this the window's surface spans the full monitor from
      // y=0 — same as the bar's own window, same layer — and mounting
      // it makes it topmost over the bar strip too. The glyph you just
      // hovered gets a synthetic pointer "leave" from the surface swap
      // even though nothing visibly moved, hoverLeave()'s close timer
      // fires, the window unmaps, the bar is topmost again, "enter"
      // fires, it reopens — a ~650ms open/close loop that reads as the
      // menu blinking. Starting the surface below the bar means the
      // bar's own window owns hover in that strip continuously, whether
      // or not a dropdown is mounted.
      marginTop={BAR_HEIGHT}
      application={app}
      $={(self: Gtk.Window) => {
        // Open with nothing focused. GTK otherwise leaves focus on the
        // panel's first control with no ring (focus-visible only shows after
        // keyboard navigation), so the first Tab skipped it and Enter would
        // have activated it unseen — Lock, in the Session panel. With no
        // focus, the first Tab lands on the first control, visibly.
        self.connect("notify::visible", () => {
          if (self.visible) self.set_focus(null)
        })

        const keys = new Gtk.EventControllerKey()
        keys.connect("key-pressed", (_c, keyval) => {
          if (keyval === Gdk.KEY_Escape) {
            closeDropdown()
            return true
          }
          return false
        })
        self.add_controller(keys)

        // Coordinate-checked pointer position, not crossing (enter/leave)
        // events — those fire on ANY re-pick, including one GTK4 runs on
        // every size-allocate. The old controller lived on the panel box
        // itself: when NetworkPanel's manual-entry form collapsed right
        // after a successful connect, the panel shrank under a pointer
        // that never moved, GTK re-picked, and the crossing controller
        // got a synthetic "leave" — hoverLeave()'s close timer fired,
        // and the whole dropdown vanished on a user who hadn't touched
        // the mouse. Checking the panel's live bounds against the
        // pointer's actual (x, y) avoids depending on crossing signals
        // at all — combined with the lastX/lastY de-dupe below (GTK
        // re-emits `motion` at an unchanged (x, y) on that same re-pick,
        // so the coordinate check alone isn't sufficient either) it only
        // reacts to a real move. Attached to the window (full-monitor
        // surface, see above) rather than the panel box itself so it
        // keeps receiving motion no matter where on screen the pointer
        // goes.
        const panelMotion = new Gtk.EventControllerMotion()
        panelMotion.connect("motion", (_c, x, y) => {
          if (x === lastX && y === lastY) return
          lastX = x
          lastY = y

          const inside = !!panelWidget && pointInWidget(panelWidget, self, x, y)
          if (inside) {
            wasInside = true
            hoverKeep()
          } else if (wasInside || isHoverOpened()) {
            wasInside = false
            hoverLeave()
          }
        })
        self.add_controller(panelMotion)
      }}
    >
      <overlay
        $={(self: Gtk.Overlay) => {
          // The scrim is the MAIN child and the panel an overlay child,
          // so a click on the panel never reaches the scrim. Putting a
          // single gesture on the window root instead would fire for
          // both, and every button press inside a panel would also
          // close it.
          const scrim = new Gtk.Box()
          const click = new Gtk.GestureClick()
          click.connect("pressed", () => closeDropdown())
          scrim.add_controller(click)
          self.set_child(scrim)
        }}
      >
        <box
          $type="overlay"
          halign={Gtk.Align.START}
          valign={Gtk.Align.START}
          marginTop={TOP_OFFSET}
          marginStart={anchorX}
          widthRequest={PANEL_WIDTH}
        >
          {/*
            Drops out of the bar rather than appearing. Done in CSS
            (opacity + margin-top) instead of with a GtkRevealer,
            because a revealer only animates its own SIZE — the panel
            slid down by growing, which reflowed every label inside it
            on every frame. Fading and offsetting the finished panel
            moves it as one object.
          */}
          <box
            class={panelClass}
            $={(self: Gtk.Widget) => {
              // Hover-keep/leave is decided by the window-level motion
              // handler above (against this widget's live bounds) —
              // just hand it the reference.
              panelWidget = self
            }}
          >
            {stack}
          </box>
        </box>
      </overlay>
    </window>
  )
}
