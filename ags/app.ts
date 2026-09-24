import app from "ags/gtk4/app"
import { Gdk, Gtk } from "ags/gtk4"
import { createRoot } from "ags"
import GLib from "gi://GLib"
import { execAsync } from "ags/process"
import style from "./style/main.scss"

import Bar from "./widget/Bar"
import BarDropdown from "./widget/BarDropdown"
import {
  closeDropdown,
  DropdownName,
  setHoveredWorkspace,
  showDropdown,
  toggleDropdown,
} from "./widget/bar/dropdown"
import NotificationPopups from "./widget/Notifications"
import Osd from "./widget/Osd"
import ControlCenter from "./widget/ControlCenter"
import { cycleNightLight } from "./widget/bar/nightState"
import { toggleCaffeine } from "./widget/bar/caffeineState"
import Switcher from "./widget/Switcher"
import * as switcher from "./widget/switcherState"
import { refreshWeather } from "./widget/bar/weatherState"
import { simulate as simulateBattery } from "./widget/bar/batteryWatch"
import Cheatsheet from "./widget/Cheatsheet"
import WallpaperSwitcher from "./widget/WallpaperSwitcher"
import { compileBandwidthLoop } from "./widget/bar/bandwidth"
import ClickHighlight from "./widget/ClickHighlight"
import { fireClick, toggleHighlight } from "./widget/bar/clickHighlightState"
import { toggleMeetingMode } from "./widget/bar/meetingModeState"
import { Activity, ACTIVITIES, switchActivity, tagFocusedToCurrent, untagFocused } from "./widget/bar/activityState"

// A handful of hand-picked, uniformly-weighted icons (see
// widget/bar/icons.ts) live outside any installed icon theme, because
// the installed theme's own "symbolic" icons vary wildly in how much
// of their canvas they actually use — a bell fills ~94% of its box, a
// wifi glyph ~69%, so at one nominal pixel size they read as different
// sizes even though the box is identical. `add_search_path` makes GTK
// look here first, same lookup mechanism as any real icon theme
// directory (mirrors `<theme>/status/symbolic/<name>.svg`).
const ICONS_DIR = `${GLib.get_home_dir()}/.config/hypr/ags/icons`

// `import style from "./style/main.scss"` is compiled to a CSS string
// ONCE, at bundle time — `ags run` never re-runs the bundler while
// live. So `style` here is frozen at whatever `_colors.scss` said at
// launch, and re-applying it on "restart-css" (below) was a no-op in
// every way that matters: matugen's post-wallpaper-change hook called
// it, "css reloaded" came back, and the bar's colours never moved.
// Fixed by shelling out to the same `sass` compiler at request time
// instead of reusing the frozen import, so a live reload actually
// re-reads the regenerated `_colors.scss` off disk.
const STYLE_ENTRY = `${GLib.get_home_dir()}/.config/hypr/ags/style/main.scss`

app.start({
  css: style,
  instanceName: "shell",

  main() {
    // Synchronous — the bandwidth glyph's subprocess (BandwidthMenu.tsx)
    // needs the binary to already exist the moment Bar() mounts below.
    compileBandwidthLoop()

    const display = Gdk.Display.get_default()
    if (display) Gtk.IconTheme.get_for_display(display).add_search_path(ICONS_DIR)

    // One bar + dropdown + notification stack + OSD per monitor, kept in
    // step with the display: a monitor plugged in later gets its own set,
    // and an unplugged one has its windows destroyed. Each set lives in
    // its own reactive root so disposing it also drops the notifd signal
    // handlers and timers the popups/OSD registered.
    const perMonitor = new Map<Gdk.Monitor, { windows: Gtk.Window[]; dispose: () => void }>()

    const syncMonitors = () => {
      const current = app.get_monitors()

      for (const [monitor, entry] of perMonitor) {
        if (current.includes(monitor)) continue
        entry.dispose()
        // Hide, do NOT destroy. w.destroy() on windows whose output has
        // just gone segfaults AGS (Gdk: "assertion GDK_IS_SURFACE
        // (surface) failed"), both in the same tick and after a delay —
        // the surface is already dead. Hidden windows are inert; the cost
        // is four small leaked widgets per unplug.
        for (const w of entry.windows) w.visible = false
        perMonitor.delete(monitor)
      }

      for (const monitor of current) {
        if (perMonitor.has(monitor)) continue
        createRoot((dispose) => {
          perMonitor.set(monitor, {
            windows: [
              Bar(monitor),
              BarDropdown(monitor),
              NotificationPopups(monitor),
              Osd(monitor),
              ClickHighlight(monitor),
            ] as Gtk.Window[],
            dispose,
          })
        })
      }
    }

    syncMonitors()
    display?.get_monitors().connect("items-changed", syncMonitors)
    ControlCenter()
    Cheatsheet()
    WallpaperSwitcher()
    Switcher()
  },

  // `ags request <msg>` — used by matugen's post_hook and by keybinds
  requestHandler(argv, res) {
    const [cmd] = argv

    switch (cmd) {
      case "restart-css":
        execAsync(["sass", STYLE_ENTRY])
          .then((css) => {
            app.apply_css(css, true)
            res("css reloaded")
          })
          .catch((err) => res(`css reload failed: ${err}`))
        return

      // `ags request -i shell nightlight` — cycles off -> auto -> on, from a keybind
      case "nightlight":
        return res(cycleNightLight())

      // `ags request -i shell switcher next|prev|commit|cancel` — the Alt-Tab window switcher
      case "switcher": {
        const a = argv[1]
        if (a === "next") switcher.step(1).then(res)
        else if (a === "prev") switcher.step(-1).then(res)
        else if (a === "commit") switcher.commit().then(res)
        else if (a === "cancel") res(switcher.cancel())
        else res("usage: switcher next|prev|commit|cancel")
        return
      }

      // `ags request -i shell caffeine` — keep the screen awake on/off
      case "caffeine":
        toggleCaffeine().then(res)
        return

      // `ags request -i shell weather-refresh` — fetch the forecast now
      case "weather-refresh":
        refreshWeather()
        return res("ok")

      // `ags request -i shell battery-sim 20 discharging` — feed a fake battery level to the
      // low-battery warnings (for testing); `battery-sim off` returns to the real battery
      case "battery-sim":
        return res(simulateBattery(argv.slice(1)))

      case "toggle-control-center":
        app.toggle_window("control-center")
        return res("ok")

      // `ags request "menu network"` — opens a bar dropdown without the
      // pointer, so the menus are reachable from a keybind too.
      case "menu": {
        const name = argv[1]
        if (!name) {
          closeDropdown()
          return res("closed")
        }
        toggleDropdown(name as DropdownName)
        return res(`toggled ${name}`)
      }

      // `ags request "workspace-preview <id>"` — keyboard equivalent for
      // the rail's hover-to-preview (WorkspaceRail.tsx sets the same
      // `hoveredWorkspace` state on pointer enter). Driven by
      // conf/binds.lua's SUPER+M submap, which has no pointer to hover
      // with. Positions off the "workspace" anchor WorkspaceRail.tsx
      // registers on the active pip.
      case "workspace-preview": {
        const id = Number(argv[1])
        if (!Number.isFinite(id)) return res(`bad workspace id: ${argv[1]}`)
        setHoveredWorkspace(id)
        showDropdown("workspace")
        return res(`preview ${id}`)
      }

      case "toggle-wallpapers":
        app.toggle_window("wallpaper-switcher")
        return res("ok")

      // `ags request "click-highlight x,y,button"` — pushed by
      // scripts/click-highlight.py on every real click; x,y,button as
      // ONE argv element (comma-joined), not three — see the "menu"
      // case above and conf/binds.lua for why argv elements matter here.
      case "click-highlight": {
        const raw = argv[1] ?? ""
        const [x, y, button] = raw.split(",")
        const nx = Number(x)
        const ny = Number(y)
        if (!Number.isFinite(nx) || !Number.isFinite(ny)) return res(`bad click-highlight payload: ${raw}`)
        fireClick({ x: nx, y: ny, button: button ?? "left" })
        return res("ok")
      }

      // `ags request click-highlight-toggle` — SUPER+SHIFT+G
      case "click-highlight-toggle":
        toggleHighlight()
        return res("ok")

      // `ags request meeting-mode` — SUPER+F4
      case "meeting-mode":
        toggleMeetingMode()
        return res("ok")

      // `ags request activity <name>` — SUPER+P then 1/2/3/4 (see
      // activityState.ts and the "project" submap in conf/binds.lua)
      case "activity": {
        const name = argv[1]
        if (!ACTIVITIES.includes(name as Activity)) return res(`bad activity: ${name}`)
        switchActivity(name as Activity).then((r) => res(r))
        return
      }

      // `ags request activity-tag` — SUPER+P then T
      case "activity-tag":
        tagFocusedToCurrent().then((r) => res(r))
        return

      // `ags request activity-untag` — SUPER+P then U
      case "activity-untag":
        untagFocused().then((r) => res(r))
        return

      default:
        return res(`unknown request: ${cmd}`)
    }
  },
})
