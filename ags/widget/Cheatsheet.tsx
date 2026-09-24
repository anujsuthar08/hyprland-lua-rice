import app from "ags/gtk4/app"
import { Astal, Gdk, Gtk } from "ags/gtk4"
import { createComputed, createState, For } from "ags"
import { execAsync } from "ags/process"

// Keybind cheat sheet. Generated from `hyprctl binds -j` every time it
// opens, so it is exactly what is bound right now — descriptions come
// from conf/binds.lua ("Group: what it does"), and a bind added there
// shows up here with no other edit.

type RawBind = {
  modmask: number
  key: string
  description: string
  submap: string
  catch_all: boolean
}
type Row = { text: string; combos: string[][]; sep: string }
type Group = { title: string; rows: Row[] }

const MODS: [number, string][] = [[64, "Super"], [4, "Ctrl"], [8, "Alt"], [1, "Shift"]]

const KEYS: Record<string, string> = {
  Return: "↵", SPACE: "Space", TAB: "Tab", ESCAPE: "Esc", GRAVE: "`", PRINT: "PrtSc",
  left: "←", right: "→", up: "↑", down: "↓",
  "mouse:272": "Drag L", "mouse:273": "Drag R", mouse_down: "Scroll ↓", mouse_up: "Scroll ↑",
  XF86AudioRaiseVolume: "Vol +", XF86AudioLowerVolume: "Vol −", XF86AudioMute: "Mute",
  XF86AudioMicMute: "Mic mute", XF86MonBrightnessUp: "Bright +", XF86MonBrightnessDown: "Bright −",
  XF86AudioPlay: "Play", XF86AudioNext: "Next", XF86AudioPrev: "Prev",
}

function combo(b: RawBind): string[] {
  const parts = MODS.filter(([bit]) => b.modmask & bit).map(([, n]) => n)
  const k = KEYS[b.key] ?? (b.key.length === 1 ? b.key.toUpperCase() : b.key)
  return [...parts, k]
}

// Submap names are Lua identifiers; show what they are for.
const SUBMAP_NAMES: Record<string, string> = { wsmap: "workspace mini-map", project: "project picker" }

const ORDER = [
  "Launch", "Windows", "Focus", "Move window", "Resize", "Workspaces", "Scratchpad",
  "Mouse", "Capture", "Media", "Panels", "Shell", "Session", "Modes", "Undescribed",
]

function build(binds: RawBind[]): Group[] {
  const groups = new Map<string, Map<string, Row>>()

  for (const b of binds) {
    if (b.catch_all) continue

    let title: string
    let text: string
    if (!b.description) {
      // Never hide a bind: one added without a description is shown here so
      // it is visible (and obviously unfinished) rather than missing.
      title = b.submap ? `In ${SUBMAP_NAMES[b.submap] ?? b.submap} mode` : "Undescribed"
      text = "no description — add one in binds.lua"
    } else if (b.submap) {
      title = `In ${SUBMAP_NAMES[b.submap] ?? b.submap} mode`
      text = b.description
    } else {
      const i = b.description.indexOf(": ")
      title = i > 0 ? b.description.slice(0, i) : "Other"
      text = i > 0 ? b.description.slice(i + 2) : b.description
    }

    // "…#3" rows (workspace keys) collapse into one "1 … 0" row.
    const numbered = /\s*#\d+$/.test(text)
    const rowKey = text.replace(/\s*#\d+$/, "")

    const g = groups.get(title) ?? new Map<string, Row>()
    const row = g.get(rowKey) ?? { text: rowKey, combos: [], sep: numbered ? "…" : "/" }
    row.combos.push(combo(b))
    g.set(rowKey, row)
    groups.set(title, g)
  }

  const rank = (t: string) => {
    const i = ORDER.indexOf(t)
    return i < 0 ? ORDER.length : i
  }

  return [...groups.entries()]
    .sort((a, b) => rank(a[0]) - rank(b[0]))
    .map(([title, rows]) => ({
      title,
      rows: [...rows.values()]
        // the panel binds come out of a Lua table in arbitrary order
        .sort((a, b) => (title === "Panels" ? a.text.localeCompare(b.text) : 0))
        .map((r) =>
        // a collapsed range shows only its two ends
        r.sep === "…" && r.combos.length > 2 ? { ...r, combos: [r.combos[0], r.combos[r.combos.length - 1]] } : r,
      ),
    }))
}

function columns(groups: Group[], n: number): Group[][] {
  const cols: Group[][] = Array.from({ length: n }, () => [])
  const heights = new Array(n).fill(0)
  for (const g of groups) {
    const i = heights.indexOf(Math.min(...heights))
    cols[i].push(g)
    heights[i] += g.rows.length + 2
  }
  return cols
}

function Combo(parts: string[]) {
  return (
    <box class="combo" spacing={3} valign={Gtk.Align.CENTER}>
      {parts.map((p) => <label class="kbd" label={p} />)}
    </box>
  )
}

function RowView(r: Row) {
  // When every alternative shares its modifiers ("Super Shift H / ←"), say
  // them once instead of once per alternative.
  const mods = (c: string[]) => c.slice(0, -1).join("+")
  const shared = r.combos.length > 1 && r.combos.every((c) => mods(c) === mods(r.combos[0]))

  const chips = shared
    ? [
        ...r.combos[0].slice(0, -1).map((p) => <label class="kbd" label={p} />),
        ...r.combos.flatMap((c, i) => [
          ...(i > 0 ? [<label class="ks-sep" label={r.sep} />] : []),
          <label class="kbd" label={c[c.length - 1]} />,
        ]),
      ]
    : r.combos.flatMap((c, i) => [
        ...(i > 0 ? [<label class="ks-sep" label={r.sep} />] : []),
        Combo(c),
      ])

  return (
    <box class="ks-row" spacing={10}>
      <label class="ks-text" label={r.text} xalign={0} hexpand />
      <box class="ks-keys" spacing={shared ? 3 : 5} halign={Gtk.Align.END} valign={Gtk.Align.CENTER}>
        {chips}
      </box>
    </box>
  )
}

function GroupView(g: Group) {
  return (
    <box class="ks-group" orientation={Gtk.Orientation.VERTICAL} spacing={1}>
      <label class="ks-title" label={g.title.toUpperCase()} xalign={0} />
      {g.rows.map(RowView)}
    </box>
  )
}

export default function Cheatsheet() {
  const { TOP, RIGHT, BOTTOM, LEFT } = Astal.WindowAnchor
  const [all, setAll] = createState<Group[]>([])
  const [query, setQuery] = createState("")

  const cols = createComputed([all, query], (groups, q) => {
    const needle = q.trim().toLowerCase()
    const shown = needle
      ? groups
          .map((g) => ({
            ...g,
            rows: g.rows.filter(
              (r) =>
                g.title.toLowerCase().includes(needle) ||
                r.text.toLowerCase().includes(needle) ||
                r.combos.some((c) => c.join(" ").toLowerCase().includes(needle)),
            ),
          }))
          .filter((g) => g.rows.length > 0)
      : groups
    return columns(shown, 4)
  })

  const empty = createComputed([cols], (c) => c.every((col) => col.length === 0))

  function refresh() {
    execAsync(["hyprctl", "binds", "-j"])
      .then((out) => setAll(build(JSON.parse(out) as RawBind[])))
      .catch((e) => console.error("cheatsheet: hyprctl binds failed", e))
  }

  let entry: Gtk.Entry | null = null

  return (
    <window
      name="cheatsheet"
      namespace="cheatsheet"
      class="Cheatsheet hypr-shell"
      visible={false}
      exclusivity={Astal.Exclusivity.IGNORE}
      keymode={Astal.Keymode.ON_DEMAND}
      anchor={TOP | BOTTOM | LEFT | RIGHT}
      application={app}
      $={(self: Gtk.Window) => {
        self.connect("notify::visible", () => {
          if (!self.visible) return
          refresh()
          if (entry) {
            entry.set_text("")
            entry.grab_focus()
          }
        })
        const keys = new Gtk.EventControllerKey()
        keys.connect("key-pressed", (_c, keyval) => {
          if (keyval !== Gdk.KEY_Escape) return false
          self.visible = false
          return true
        })
        self.add_controller(keys)
      }}
    >
      <overlay
        $={(self: Gtk.Overlay) => {
          // scrim is the main child, the card an overlay child, so a click
          // on the card never reaches the scrim (same layout as ControlCenter)
          const scrim = new Gtk.Box()
          const click = new Gtk.GestureClick()
          click.connect("pressed", () => {
            const win = self.get_root() as Gtk.Window | null
            if (win) win.visible = false
          })
          scrim.add_controller(click)
          self.set_child(scrim)
        }}
      >
        <box
          $type="overlay"
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
          class="Dropdown shown Panel Cheat"
          orientation={Gtk.Orientation.VERTICAL}
          spacing={12}
        >
          <box spacing={10}>
            <label class="panel-title" label="Keyboard shortcuts" xalign={0} hexpand />
            <entry
              class="ks-search"
              placeholderText="Filter…"
              widthChars={18}
              $={(self: Gtk.Entry) => { entry = self }}
              onNotifyText={({ text }) => setQuery(text)}
            />
          </box>

          <box class="ks-columns" spacing={26}>
            <For each={cols}>
              {(col: Group[]) => (
                <box orientation={Gtk.Orientation.VERTICAL} spacing={14} valign={Gtk.Align.START}>
                  {col.map(GroupView)}
                </box>
              )}
            </For>
          </box>

          <label class="dim" label="Nothing matches" visible={empty} />
        </box>
      </overlay>
    </window>
  )
}
