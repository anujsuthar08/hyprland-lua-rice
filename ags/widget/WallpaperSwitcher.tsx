import app from "ags/gtk4/app"
import { Astal, Gtk } from "ags/gtk4"
import { For, With, createComputed, createState } from "ags"
import { execAsync } from "ags/process"
import { timeout } from "ags/time"
import Gdk from "gi://Gdk?version=4.0"
import Gio from "gi://Gio"
import GLib from "gi://GLib"

// The switcher is a thin GUI over two scripts, deliberately:
//   scripts/get-wallpapers.py   catalogue + thumbnails  (what to show)
//   scripts/wallpaper.sh        apply                   (what to do)
// so the rofi fallback, autostart --restore and this widget all go
// through the same apply path and can never drift apart.
const HOME = GLib.get_home_dir()
const SCRIPTS = `${HOME}/.config/hypr/scripts`
const INDEX = `${SCRIPTS}/get-wallpapers.py`
const APPLY = `${SCRIPTS}/wallpaper.sh`

const COLLECTION = `${HOME}/.config/wallpapers`
const THUMBS = `${HOME}/.cache/wallpaper-thumbs`

type Target = "desktop" | "lockscreen" | "sddm"

const TARGETS: { id: Target; icon: string; label: string }[] = [
  { id: "desktop", icon: "󰸉", label: "Desktop" },
  { id: "lockscreen", icon: "󰌾", label: "Lock screen" },
  { id: "sddm", icon: "󰍂", label: "Login screen" },
]

// Mirror of get-wallpapers.py's thumb_path(). Kept in sync by hand — the
// alternative is a subprocess per tile, which is 106 spawns on open.
function thumbOf(wallpaper: string) {
  return wallpaper
    .replace(`${COLLECTION}/`, `${THUMBS}/`)
    .replace(/\.[^/.]+$/, ".jpg")
}

function basename(path: string) {
  return path.split("/").pop() ?? path
}

// Booru filenames are 60+ characters of hash. Show enough to tell two
// apart and let the tooltip carry the whole thing.
function shortName(path: string) {
  const name = basename(path).replace(/\.[^/.]+$/, "")
  return name.length > 22 ? `${name.slice(0, 21)}…` : name
}

function isAnimated(path: string) {
  return /\.(mp4|webm|mkv|mov|gif)$/i.test(path)
}

function fileSize(path: string) {
  try {
    const info = Gio.File.new_for_path(path).query_info(
      "standard::size",
      Gio.FileQueryInfoFlags.NONE,
      null,
    )
    const mb = info.get_size() / (1024 * 1024)
    return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(mb * 1024)} KB`
  } catch {
    return "unknown size"
  }
}

// A single wallpaper image. Gtk.Picture (not Gtk.Image) because these are
// photographs, not icons: COVER crops to fill instead of letterboxing, and
// canShrink lets a tile get smaller than the 320px thumbnail.
function Thumb(props: { file: string; width: number; height: number }) {
  return (
    <Gtk.Picture
      file={Gio.File.new_for_path(props.file)}
      contentFit={Gtk.ContentFit.COVER}
      canShrink
      widthRequest={props.width}
      heightRequest={props.height}
    />
  )
}

export default function WallpaperSwitcher() {
  const { LEFT, RIGHT, BOTTOM } = Astal.WindowAnchor

  const [catalog, setCatalog] = createState<Record<string, string[]>>({})
  const [category, setCategory] = createState<string>("defaults/images_sfw")
  const [target, setTarget] = createState<Target>("desktop")
  const [current, setCurrent] = createState<Record<string, string | null>>({})
  const [status, setStatusRaw] = createState<"idle" | "busy" | "ok" | "error">("idle")

  // "ok" and "error" are acknowledgements, not states — they should
  // clear themselves. "busy" stays until whatever set it replaces it.
  function setStatus(next: "idle" | "busy" | "ok" | "error") {
    setStatusRaw(next)
    if (next === "ok" || next === "error") {
      timeout(next === "ok" ? 1200 : 4000, () => {
        if (status.peek() === next) setStatusRaw("idle")
      })
    }
  }
  // right-click arms a delete instead of performing one — see the confirm bar
  const [pendingDelete, setPendingDelete] = createState<string | null>(null)

  const categories = createComputed(() => Object.keys(catalog()).sort())

  const shown = createComputed(() => catalog()[category()] ?? [])

  function refreshCurrent() {
    return execAsync(`${INDEX} --current`)
      .then((out) => setCurrent(JSON.parse(String(out))))
      .catch(() => {})
  }

  // `--fast` skips thumbnail generation. Opening the panel should never
  // block on magick; the explicit rescan button is what regenerates.
  function refreshCatalog(withThumbs = false) {
    setStatus("busy")
    return execAsync(`${INDEX} --list${withThumbs ? "" : " --fast"}`)
      .then((out) => {
        const parsed: Record<string, string[]> = JSON.parse(String(out))
        setCatalog(parsed)
        if (!parsed[category.peek()]) {
          const first = Object.keys(parsed).sort()[0]
          if (first) setCategory(first)
        }
        setStatus("ok")
      })
      .catch((err) => {
        setStatus("error")
        console.error("wallpaper catalogue failed", err)
      })
  }

  function apply(wallpaper: string) {
    setStatus("busy")
    // Arguments go through a shell here, so quote: the collection is
    // fine, but "add custom wallpaper" accepts any filename the user picks.
    execAsync(["bash", "-c", `${APPLY} --set ${target.peek()} ${GLib.shell_quote(wallpaper)}`])
      .then(() => {
        setStatus("ok")
        return refreshCurrent()
      })
      .catch((err) => {
        setStatus("error")
        console.error("wallpaper apply failed", err)
      })
  }

  function applyRandom() {
    setStatus("busy")
    execAsync(["bash", "-c", `${APPLY} --random ${target.peek()}`])
      .then(() => {
        setStatus("ok")
        return refreshCurrent()
      })
      .catch(() => setStatus("error"))
  }

  function confirmDelete() {
    const victim = pendingDelete.peek()
    if (!victim) return
    setPendingDelete(null)
    setStatus("busy")
    execAsync([
      "bash",
      "-c",
      `rm -f ${GLib.shell_quote(victim)} ${GLib.shell_quote(thumbOf(victim))}`,
    ])
      .then(() => refreshCatalog())
      .catch(() => setStatus("error"))
  }

  function addWallpaper() {
    setStatus("busy")
    execAsync([
      "zenity",
      "--file-selection",
      "--title=Add wallpaper",
      "--file-filter=Wallpapers | *.png *.jpg *.jpeg *.webp *.gif *.mp4 *.webm",
    ])
      .then((out) => {
        const src = String(out).trim()
        if (!src) {
          setStatus("idle")
          return
        }
        const dest = `${COLLECTION}/custom/${basename(src)}`
        return execAsync([
          "bash",
          "-c",
          `mkdir -p ${GLib.shell_quote(`${COLLECTION}/custom`)} && ` +
            `cp -- ${GLib.shell_quote(src)} ${GLib.shell_quote(dest)}`,
        ])
          .then(() => refreshCatalog(true))
          .then(() => setCategory("custom"))
      })
      .catch(() => {
        // zenity exits 1 when the dialog is cancelled — not an error
        setStatus("idle")
      })
  }

  // ── header: what am I setting, and where ──────────────────────────
  //
  // The three tiles are the point of the whole panel: each shows the
  // wallpaper currently applied to that target, and clicking one makes
  // it the target for the next pick. Selecting and previewing are the
  // same control, so there is never a doubt about what a click will do.
  const targetTiles = (
    <box class="targets" spacing={10} halign={Gtk.Align.CENTER}>
      {TARGETS.map((t) => (
        <button
          class={createComputed(() =>
            ["target-tile", target() === t.id && "selected"].filter(Boolean).join(" "),
          )}
          onClicked={() => setTarget(t.id)}
          tooltipMarkup={`Set the <b>${t.label.toLowerCase()}</b> wallpaper`}
        >
          <box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
            <With value={createComputed(() => current()[t.id] ?? null)}>
              {(file: string | null) =>
                file ? (
                  <Thumb file={thumbOf(file)} width={208} height={117} />
                ) : (
                  <box class="empty-preview" widthRequest={208} heightRequest={117}>
                    <label label="none" halign={Gtk.Align.CENTER} valign={Gtk.Align.CENTER} />
                  </box>
                )
              }
            </With>
            <box spacing={6} halign={Gtk.Align.CENTER}>
              <label label={t.icon} />
              <label label={t.label} />
            </box>
          </box>
        </button>
      ))}
    </box>
  )

  const categorySelector = (
    <menubutton class="category-selector" valign={Gtk.Align.CENTER}>
      <label label={createComputed(() => category())} />
      <popover>
        <With value={categories}>
          {(list: string[]) => (
            <box orientation={Gtk.Orientation.VERTICAL} spacing={4} class="popover-list">
              {list.map((c) => (
                <button class="category" onClicked={() => setCategory(c)}>
                  <label label={c} xalign={0} />
                </button>
              ))}
            </box>
          )}
        </With>
      </popover>
    </menubutton>
  )

  const actions = (
    <box class="actions" spacing={8} halign={Gtk.Align.CENTER}>
      {categorySelector}
      <button
        class="action"
        onClicked={applyRandom}
        tooltipMarkup="Apply a <b>random</b> wallpaper"
      >
        <label label="󰒟" />
      </button>
      <button
        class="action"
        onClicked={() => refreshCatalog(true).then(() => refreshCurrent())}
        tooltipMarkup="<b>Rescan</b> the collection and rebuild thumbnails"
      >
        <label label="󰑐" />
      </button>
      <button
        class="action"
        onClicked={addWallpaper}
        tooltipMarkup="<b>Add</b> a wallpaper from a file"
      >
        <label label="󰐕" />
      </button>
      <label
        class={createComputed(() => `status ${status()}`)}
        label={createComputed(() =>
          ({ idle: "", busy: "󰄉", ok: "󰄬", error: "󰅖" })[status()],
        )}
      />
    </box>
  )

  // Right-click arms this bar rather than deleting immediately. The old
  // switcher deleted a wallpaper on a single right-click, with no undo —
  // easy to trigger while scrolling a 64-image strip.
  const confirmBar = (
    <With value={pendingDelete}>
      {(victim: string | null) =>
        victim ? (
          <box class="confirm" spacing={10} halign={Gtk.Align.CENTER}>
            <label label={`Delete ${shortName(victim)}?`} />
            <button class="danger" onClicked={confirmDelete}>
              <label label="Delete" />
            </button>
            <button onClicked={() => setPendingDelete(null)}>
              <label label="Cancel" />
            </button>
          </box>
        ) : (
          <box />
        )
      }
    </With>
  )

  const grid = (
    <Gtk.ScrolledWindow
      hscrollbarPolicy={Gtk.PolicyType.AUTOMATIC}
      vscrollbarPolicy={Gtk.PolicyType.NEVER}
      hexpand
    >
      <box class="all-wallpapers" spacing={8} valign={Gtk.Align.START}>
        <For each={shown}>
          {(wallpaper: string) => (
            <button
              class={createComputed(() =>
                [
                  "wallpaper-tile",
                  current()[target()] === wallpaper && "active",
                  pendingDelete() === wallpaper && "doomed",
                ]
                  .filter(Boolean)
                  .join(" "),
              )}
              onClicked={() => apply(wallpaper)}
              tooltipMarkup={createComputed(
                () =>
                  `Set as <b>${target()}</b> wallpaper\n` +
                  `${basename(wallpaper)}\n` +
                  `${fileSize(wallpaper)}${isAnimated(wallpaper) ? " · animated" : ""}\n` +
                  `<i>right-click to delete</i>`,
              )}
              // GTK4 has no right-click signal on a button; a gesture
              // controller with button=3 is the supported route.
              $={(self: Gtk.Button) => {
                const rightClick = new Gtk.GestureClick({ button: 3 })
                rightClick.connect("pressed", () => setPendingDelete(wallpaper))
                self.add_controller(rightClick)
              }}
            >
              <box orientation={Gtk.Orientation.VERTICAL} spacing={4}>
                <Thumb file={thumbOf(wallpaper)} width={176} height={99} />
                <box spacing={4} halign={Gtk.Align.CENTER}>
                  {isAnimated(wallpaper) ? <label class="badge" label="󰈫" /> : <box />}
                  <label class="tile-name" label={shortName(wallpaper)} />
                </box>
              </box>
            </button>
          )}
        </For>
      </box>
    </Gtk.ScrolledWindow>
  )

  return (
    <window
      name="wallpaper-switcher"
      namespace="wallpaper-switcher"
      class="WallpaperSwitcher hypr-shell"
      visible={false}
      layer={Astal.Layer.OVERLAY}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.ON_DEMAND}
      anchor={LEFT | RIGHT | BOTTOM}
      application={app}
      $={(self: Gtk.Window) => {
        refreshCatalog()
        refreshCurrent()

        // The window is constructed ONCE at shell startup and only
        // toggles visible/hidden after that — app.toggle_window never
        // re-runs this initializer. Without this, a category rescans
        // only when SOMETHING calls refreshCatalog() again (the rescan
        // button, or "add"): any wallpaper added or removed on disk any
        // other way (the CLI, this very panel changing the collection
        // out from under a still-running shell) stays invisible until
        // then, and clicking one of those stale entries fails with
        // "not a file". Refresh on every reopen instead.
        self.connect("notify::visible", () => {
          if (self.visible) {
            refreshCatalog()
            refreshCurrent()
          }
        })

        // ON_DEMAND keymode takes the keyboard while the panel is up, so
        // it has to hand it back itself. Escape closes; it also clears an
        // armed delete first, so one key never both cancels and closes.
        const keys = new Gtk.EventControllerKey()
        keys.connect("key-pressed", (_c, keyval) => {
          if (keyval !== Gdk.KEY_Escape) return false
          if (pendingDelete.peek()) {
            setPendingDelete(null)
          } else {
            self.hide()
          }
          return true
        })
        self.add_controller(keys)
      }}
    >
      <box class="panel" orientation={Gtk.Orientation.VERTICAL} spacing={12}>
        <box spacing={16} halign={Gtk.Align.CENTER}>
          {targetTiles}
        </box>
        {actions}
        {confirmBar}
        {grid}
      </box>
    </window>
  )
}
