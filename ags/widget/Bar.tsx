import app from "ags/gtk4/app"
import { Astal, Gtk, Gdk } from "ags/gtk4"
import { createState, createComputed, onCleanup } from "ags"
import { timeout, Timer } from "ags/time"
import { pointerOver } from "./bar/pointer"
import Gtk4LayerShell from "gi://Gtk4LayerShell?version=1.0"
import AstalHyprland from "gi://AstalHyprland?version=0.1"

import WorkspaceRail from "./bar/WorkspaceRail"
import FocusedWindow from "./bar/FocusedWindow"
import Clock from "./bar/Clock"
import Battery from "./bar/Battery"
import SysTray from "./bar/SysTray"
import VolumeMenu from "./bar/VolumeMenu"
import NetworkMenu from "./bar/NetworkMenu"
import BandwidthMenu from "./bar/BandwidthMenu"
import VpnIndicator from "./bar/VpnIndicator"
import BluetoothMenu from "./bar/BluetoothMenu"
import PhoneMenu from "./bar/PhoneMenu"
import PlayerMenu from "./bar/PlayerMenu"
import NotificationMenu from "./bar/NotificationMenu"
import SessionMenu from "./bar/SessionMenu"
import Mic from "./bar/Mic"
import Recording from "./bar/Recording"
import Nightlight from "./bar/Nightlight"
import Caffeine from "./bar/Caffeine"
import Activity from "./bar/Activity"
import Timer from "./bar/Timer"
import WeatherMenu from "./bar/WeatherMenu"
import SystemMenu from "./bar/SystemMenu"
import { closeDropdown, openDropdown } from "./bar/dropdown"

//
// A centred TAB, hanging off the top edge: as wide as its contents,
// flush to the top, corners rounded only at the bottom.
//
// Two rebuilds on 2026-09-03. First a full-width edge bar, replacing a
// centred floating capsule — because the capsule silhouette (a
// translucent pill hovering in the middle of the top edge, full of
// nerd-font glyphs) is what every generated rice looks like, however
// carefully the inside of it is tuned. Then this: the edge bar's
// CONTENT was right and its width was not, so the strip shrank to fit
// while keeping everything that made it work.
//
// It stays welded to the edge rather than floating below it. That is
// the whole difference between this and the capsule it replaced — a
// detached pill has to draw its own outline on all four sides and
// light itself like an object; a tab borrows the screen edge for its
// top and only has to finish three sides. It is also what the previous
// rice did (~/.config/ags.bak-20260830-222641: `.bar { border-radius:
// 0 0 10px 10px }`), at full width.
//
// The rules that survived both rewrites:
//   * the height is a constant — nothing the bar does changes it
//   * anything needing real estate is a DROPDOWN, on its own layer
//     window (BarDropdown.tsx)
//   * hovering only ADDS; it never moves what is already there
//
// Laid out as a centerbox so the CLOCK sits in the middle, with the
// workspaces to its left and the status cluster to its right. On a tab
// that is itself centred on the monitor, that puts the time at the
// centre of the screen and keeps it there: the two side groups grow
// outward on hover, away from the middle, rather than pushing it.
//

// Strip height. The reserved zone is read back from the surface rather
// than asserted — get them out of step and the bar hangs over the top
// of every window by the difference. This value is the fallback used
// before the first allocation, and BarDropdown's TOP_OFFSET is
// measured from it.
const BAR_HEIGHT = 38

// Crossing the gap between two child widgets briefly leaves the strip.
// Long enough to be forgiving, short enough not to feel stuck.
const COLLAPSE_GRACE = 220

export default function Bar(gdkmonitor: Gdk.Monitor) {
  const { TOP, LEFT, RIGHT } = Astal.WindowAnchor

  const [hovered, setHovered] = createState(false)

  // A dropdown is a different window, so opening one moves the pointer
  // off the bar and the hover would collapse the detail out from under
  // the menu that is still up.
  const expanded = createComputed(
    [hovered, openDropdown],
    (h, open) => h || open !== null,
  )

  // Astal writes the exclusive zone itself when it applies Exclusivity,
  // and it wins the race against a call made at realize — measured on
  // an earlier bar: `reserved` stayed [0,0,0,0] with the pin in place.
  // Re-applying shortly after map makes ours the last write.
  let winRef: Gtk.Window | null = null
  const applyZone = () => {
    if (!winRef) return
    const h = winRef.get_height()
    Gtk4LayerShell.set_exclusive_zone(winRef, h > 0 ? h : BAR_HEIGHT)
  }
  timeout(600, applyZone)

  // Hide for a real fullscreen client (video, a game) on THIS bar's own
  // output, not a maximised window (Fullscreen.FULLSCREEN specifically
  // excludes MAXIMIZED) and not a fullscreen window sitting unfocused on
  // a different monitor.
  //
  // Originally bound to the focused CLIENT's own `fullscreen` (not, as
  // first tried, `focusedWorkspace.hasFullscreen` — that's stale: per
  // AstalHyprland's source, the "fullscreen" IPC event only triggers
  // `sync_clients`, never a `Workspace.sync`, confirmed by reproducing it
  // live — fullscreening a client moved `hasfullscreen: true` in
  // `hyprctl activeworkspace -j` but the Astal property's `notify` never
  // fired). That version was keyed to the FOCUSED client, so a fullscreen
  // window sitting unfocused on a second display left that display's bar
  // showing — the deferred item this fixes.
  //
  // Fix: don't derive this from any single client's property binding at
  // all. Recompute "is a fullscreen client visible on THIS monitor's
  // active workspace" from scratch on Hyprland's generic `event` signal,
  // which every bar instance connects to independently. Checked in
  // hyprland.c (astal-hyprland's build): that signal is the LAST thing
  // `handle_event_co` does for every event type — emitted only after that
  // event's own branch (e.g. "fullscreen"'s `sync_clients` await) has
  // fully completed, so `hypr.clients` and each monitor's
  // `activeWorkspace` are always current by the time this handler runs.
  // This also fixes the workspace-switch case for free: switching away
  // from a workspace holding a still-"fullscreen" client (which keeps
  // that state even off-screen) now correctly brings the bar back,
  // something a plain per-client binding could never express.
  const hypr = AstalHyprland.get_default()

  const computeFullscreen = () => {
    // Read the connector fresh each time, not captured once into a const: a
    // monitor that JUST appeared (headless test output, real hotplug) can
    // have a null connector name for its first few event cycles, the same
    // "brand-new monitor" gap already hit once in WorkspaceRail.tsx. A
    // stale-null capture would wedge this monitor's bar into "never
    // fullscreen" forever, not just until the name resolves.
    const name = gdkmonitor.get_connector()
    if (!name) return false
    const activeId = hypr.get_monitor_by_name(name)?.activeWorkspace?.id
    if (activeId == null) return false
    return hypr.clients.some(
      (c) => c.workspace?.id === activeId && c.fullscreen === AstalHyprland.Fullscreen.FULLSCREEN,
    )
  }

  const [fullscreen, setFullscreen] = createState(computeFullscreen())
  const eventId = hypr.connect("event", () => setFullscreen(computeFullscreen()))
  onCleanup(() => hypr.disconnect(eventId))

  // A hidden window still eats a layer-shell exclusive zone until told
  // otherwise — GTK's own `visible` has no opinion on that, it is a
  // separate call. Released going in, restored coming back out; an open
  // dropdown is closed rather than left pointing at a glyph that just
  // disappeared.
  fullscreen.subscribe(() => {
    if (fullscreen.get()) {
      closeDropdown()
      if (winRef) Gtk4LayerShell.set_exclusive_zone(winRef, 0)
    } else {
      applyZone()
    }
  })

  const tabClass = createComputed([expanded], (e) => (e ? "tab open" : "tab"))

  return (
    <window
      visible={createComputed([fullscreen], (fs) => !fs)}
      name="bar"
      // namespace must match the layer_rule in conf/rules.lua for blur
      namespace="bar"
      class="Bar hypr-shell"
      gdkmonitor={gdkmonitor}
      // NORMAL, not EXCLUSIVE: EXCLUSIVE turns on layer-shell's
      // auto-exclusive-zone, which re-reserves the window's own height
      // on every resize. The explicit pin keeps the reserved strip a
      // stated number rather than a side effect of layout.
      exclusivity={Astal.Exclusivity.NORMAL}
      keymode={Astal.Keymode.NONE}
      anchor={TOP | LEFT | RIGHT}
      application={app}
      $={(self: Gtk.Window) => {
        winRef = self
        self.connect("realize", applyZone)
        self.connect("map", applyZone)
      }}
    >
      <centerbox valign={Gtk.Align.START}>
        <box $type="start" hexpand />

        <box
          $type="center"
          class={tabClass}
          hexpand={false}
          valign={Gtk.Align.START}
          $={(self: Gtk.Widget) => {
            // Hover is on the whole tab, not on each widget. The pointer
            // arriving at the tab is the intent; what it reveals — the
            // window title, SSID, volume, the date — appears in place
            // beside the thing it belongs to.
            let leaveTimer: Timer | null = null
            const motion = new Gtk.EventControllerMotion()

            motion.connect("enter", () => {
              leaveTimer?.cancel()
              leaveTimer = null
              setHovered(true)
            })

            motion.connect("leave", () => {
              leaveTimer?.cancel()
              leaveTimer = timeout(COLLAPSE_GRACE, () => {
                leaveTimer = null
                // A `leave` is not proof the pointer left: GTK reports one
                // when a dropdown maps under a resting pointer. Ask the
                // compositor; only collapse if it is genuinely elsewhere.
                pointerOver(self).then((over) => {
                  if (!over && leaveTimer === null) setHovered(false)
                })
              })
            })

            self.add_controller(motion)
          }}
        >
          <centerbox>
            {/*
              Rail first, then what is focused inside it. The title is
              on at all times rather than behind the hover: with the
              clock holding the middle, a hover-only title left this
              half of the tab visibly empty, and "which window has the
              keyboard" is worth the width on a bar you keep.
            */}
            <box $type="start">
              <WorkspaceRail />
              <FocusedWindow />
            </box>

            <box $type="center" class="middle">
              <Clock reveal={expanded} />
            </box>

            <box $type="end" class="cluster" spacing={2}>
              <Recording />
              <Timer />
              <Activity />
              <Caffeine />
              <Nightlight />
              <SystemMenu reveal={expanded} />
              <WeatherMenu reveal={expanded} />
              <Mic />
              <PlayerMenu reveal={expanded} />
              <NotificationMenu reveal={expanded} />
              <VolumeMenu reveal={expanded} />
              <NetworkMenu reveal={expanded} />
              <VpnIndicator />
              <BandwidthMenu reveal={expanded} />
              <BluetoothMenu reveal={expanded} />
              <PhoneMenu reveal={expanded} />
              <SysTray />
              <Battery />
              <SessionMenu />
            </box>
          </centerbox>
        </box>

        <box $type="end" hexpand />
      </centerbox>
    </window>
  )
}
