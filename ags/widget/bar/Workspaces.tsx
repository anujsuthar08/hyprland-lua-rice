import { createBinding, createComputed, For } from "ags"
import AstalHyprland from "gi://AstalHyprland?version=0.1"

// Workspaces 1..BASE are persistent (conf/rules.lua) so they always show.
const BASE = 9

// Order the named project workspaces the way conf/binds.lua's SUPER+P
// submap orders them (w / h / r / s), not alphabetically — the bar
// should read in the same order as the keys you press. Anything not
// listed falls to the end, alphabetically.
const PROJECT_ORDER = ["web", "hackathon", "rice", "research"]

function projectRank(name: string) {
  const i = PROJECT_ORDER.indexOf(name)
  return i === -1 ? PROJECT_ORDER.length : i
}

type Item = {
  key: string
  label: string
  named: boolean
  occupied: boolean
  active: boolean
  // a Lua EXPRESSION, not a hyprlang dispatcher name — see goTo()
  lua: string
}

// ⚠️ AstalHyprland's `dispatch(verb, args)` sends the old hyprlang form
// `dispatch workspace 3`. Under the Lua config (0.55+) Hyprland wraps
// whatever follows `dispatch` into `return hl.dispatch(<it>)` and
// EVALUATES IT AS LUA, so the old form dies with
//   error: [string "return hl.dispatch(workspace 3)"]:1: ')' expected
// and the click silently does nothing. Send a Lua expression over the
// raw message socket instead.
function goTo(lua: string) {
  const hypr = AstalHyprland.get_default()
  try {
    hypr.message_async(`dispatch ${lua}`, null)
  } catch (e) {
    console.error("workspace dispatch failed", e)
  }
}

export default function Workspaces() {
  const hypr = AstalHyprland.get_default()

  const focused = createBinding(hypr, "focusedWorkspace")
  const spaces = createBinding(hypr, "workspaces")

  const items = createComputed([spaces, focused], (all, f): Item[] => {
    const focusedId = f?.id ?? -1

    // ── numbered workspaces ──
    // Always show 1..BASE, but also include any *other* numbered
    // workspace that has windows or is currently focused — otherwise
    // the bar shows nothing highlighted whenever the active workspace
    // falls outside the fixed range (happens on a second monitor, and
    // in a nested test instance).
    const ids = new Set<number>()
    for (let i = 1; i <= BASE; i++) ids.add(i)
    for (const w of all) {
      if (w.id > 0 && (w.clients.length > 0 || w.id === focusedId)) ids.add(w.id)
    }
    if (focusedId > 0) ids.add(focusedId)

    const numbered: Item[] = [...ids]
      .sort((a, b) => a - b)
      .map((id) => {
        const ws = all.find((w) => w.id === id)
        return {
          key: `n${id}`,
          label: String(id),
          named: false,
          occupied: !!ws && ws.clients.length > 0,
          active: id === focusedId,
          lua: `hl.dsp.focus({workspace=${id}})`,
        }
      })

    // ── named project workspaces (web / hackathon / rice / research) ──
    // These carry NEGATIVE ids (-1337, -1338, ...), so the `id > 0`
    // filter above skips them entirely. Without this block they would
    // be invisible AND nothing in the bar would highlight while one of
    // them is focused. Special workspaces are also negative, so they
    // are excluded by name.
    const named: Item[] = all
      .filter((w) => w.id < 0 && !w.name.startsWith("special"))
      .sort((a, b) => projectRank(a.name) - projectRank(b.name) || a.name.localeCompare(b.name))
      .map((w) => ({
        key: `s${w.name}`,
        label: w.name,
        named: true,
        occupied: w.clients.length > 0,
        active: w.id === focusedId,
        lua: `hl.dsp.focus({workspace="name:${w.name}"})`,
      }))

    return [...numbered, ...named]
  })

  return (
    <box class="Workspaces">
      <For each={items}>
        {(w: Item) => (
          <button
            class={["ws", w.named && "named", w.occupied && "occupied", w.active && "active"]
              .filter(Boolean)
              .join(" ")}
            onClicked={() => goTo(w.lua)}
          >
            <label label={w.label} />
          </button>
        )}
      </For>
    </box>
  )
}
