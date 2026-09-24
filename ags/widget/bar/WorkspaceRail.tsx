import { createBinding, createComputed, onCleanup } from "ags"
import { Gdk, Gtk } from "ags/gtk4"
import AstalHyprland from "gi://AstalHyprland?version=0.1"
import { iconFor } from "./appIcon"
import { hoverEnter, hoverLeave, registerAnchor, setHoveredWorkspace } from "./dropdown"

// The workspace rail: what is running, not what number it is.
//
// Third design for this strip. It was pips, then miniature wireframes
// of the real tiling. The wireframes were the more interesting idea and
// they still lose: at bar size a maximised window is a filled rectangle
// and a two-way split is two filled rectangles, so nine workspaces
// rendered as nine grey boxes — which is exactly what an unfinished
// mockup looks like. Icons carry the one thing the grey boxes never
// could: WHICH app. They also bring the only real colour on the bar,
// from the apps themselves rather than from a palette.
//
// This is also what the pre-rebuild rice did
// (~/.config/ags.bak-20260830-222641 — workspaces.scss, `.image`), so
// it is a return to something that worked, not a new experiment.

const MAX_ICONS = 3
const ICON_PX = 16

type Item = {
  key: string
  id: number
  active: boolean
  occupied: boolean
  icons: string[]
  overflow: number
  lua: string
}

type SpecialInfo = {
  occupied: boolean
  active: boolean
  icons: string[]
  overflow: number
}

// See Workspaces.tsx — AstalHyprland's dispatch(verb, args) emits the
// dead pre-Lua form under a Lua config, so send the expression raw.
function goTo(lua: string) {
  const hypr = AstalHyprland.get_default()
  try {
    hypr.message_async(`dispatch ${lua}`, null)
  } catch (e) {
    console.error("workspace dispatch failed", e)
  }
}

// Drop a dragged window onto the left/right half of a pip to choose
// which side of that workspace's last-focused window it lands on,
// instead of wherever dwindle's default insertion happens to put it.
//
// `hl.dsp.layout("preselect l"/"r")` is dwindle's `layoutmsg preselect`
// under the new dispatcher — a raw string arg, not a table (tested: a
// table form errors "expected string, got table"). Verified in a
// nested instance that it needs no live focus switch to the target
// workspace first: it acts on that workspace's own remembered
// last-focused window, so it stays correct while the user is still
// looking at a completely different workspace during the drag. Only
// "l" and "r" were confirmed to place correctly (right of / left of
// the target); "u" did not behave as "up" (it produced a left/right
// split, not top/bottom) so up/down splitting is deliberately not
// exposed here.
//
// The preselect and the move are sent as ONE dispatch — an
// immediately-invoked Lua function — rather than two separate
// `message_async` calls. Two calls raced: nothing in this codebase
// guarantees the second socket write lands after the first is
// processed, and preselect only affects the very next placement, so a
// reordered pair silently drops the split. Confirmed working as a
// single message in a nested instance.
function goToSplit(direction: "l" | "r", workspaceId: number, pid: number) {
  const hypr = AstalHyprland.get_default()
  const lua =
    `(function() hl.dispatch(hl.dsp.layout("preselect ${direction}")); ` +
    `return hl.dsp.window.move({workspace=${workspaceId}, window="pid:${pid}"}) end)()`
  try {
    hypr.message_async(`dispatch ${lua}`, null)
  } catch (e) {
    console.error("workspace split-drop dispatch failed", e)
  }
}

function dedupClasses(names: string[]): string[] {
  const out: string[] = []
  for (const n of names) if (n && !out.includes(n)) out.push(n)
  return out
}

// Shared between numbered pips and the scratchpad pip below: renders
// either a bare "mark" dot or a row of app icons, and only touches the
// DOM when the shape actually changed — otherwise every mouse move over
// a window would swap the icons out from under their own animation.
function renderPipContent(
  btn: Gtk.Button,
  entry: { shape: string },
  occupied: boolean,
  icons: string[],
  overflow: number,
) {
  const shape = occupied ? `icons:${icons.join(",")}+${overflow}` : "dot"
  if (shape === entry.shape) return
  entry.shape = shape

  if (!occupied) {
    // The mark is a CHILD, not a size request on the button. An empty
    // GtkButton ignores set_size_request and gets allocated whatever is
    // left over — which rendered every dot as a 1px vertical hairline.
    // Sizing the child from CSS min-width/min-height is the reliable
    // form, and it is also the only form that can be transitioned.
    const mark = new Gtk.Box({ valign: Gtk.Align.CENTER })
    mark.add_css_class("mark")
    btn.set_child(mark)
  } else {
    // Unlike `mark` above, this box never set its own valign — it
    // defaulted to fill, so the row (and the icon inside it) sat
    // wherever the fallback icon's own internal padding happened to
    // put it instead of on the same centre line as the dots either
    // side of it.
    const row = new Gtk.Box({ spacing: 3, valign: Gtk.Align.CENTER })
    for (const name of icons) {
      row.append(new Gtk.Image({ iconName: name, pixelSize: ICON_PX, valign: Gtk.Align.CENTER }))
    }
    if (overflow > 0) {
      const more = new Gtk.Label({ label: `+${overflow}` })
      more.add_css_class("overflow")
      row.append(more)
    }
    btn.set_child(row)
  }
}

export default function WorkspaceRail() {
  const hypr = AstalHyprland.get_default()

  const clients = createBinding(hypr, "clients")
  const spaces = createBinding(hypr, "workspaces")
  const focused = createBinding(hypr, "focusedWorkspace")

  const state = createComputed(
    [clients, spaces, focused],
    (allClients, allSpaces, f): { items: Item[]; special: SpecialInfo } => {
      const focusedId = f?.id ?? -1

      // Live workspaces only — whatever Hyprland has actually created,
      // plus anything holding a window. Padding the rail out to a fixed
      // nine was what made the old version look like a placeholder.
      const ids = new Set<number>()
      for (const w of allSpaces) if (w.id > 0) ids.add(w.id)
      for (const c of allClients) {
        const id = c.workspace?.id ?? -1
        if (id > 0) ids.add(id)
      }
      if (focusedId > 0) ids.add(focusedId)

      const items: Item[] = [...ids]
        .sort((a, b) => a - b)
        .map((id) => {
          const own = allClients.filter((c) => (c.workspace?.id ?? -1) === id)

          // One icon per app, not per window: six terminals in a
          // workspace is one fact, not six.
          const classes = dedupClasses(own.map((c) => c.class || c.initialClass || ""))

          return {
            key: `w${id}`,
            id,
            active: id === focusedId,
            occupied: own.length > 0,
            icons: classes.slice(0, MAX_ICONS).map(iconFor),
            overflow: Math.max(0, classes.length - MAX_ICONS),
            lua: `hl.dsp.focus({workspace=${id}})`,
          }
        })

      // The scratchpad. Hyprland doesn't create this workspace at all
      // until it's been toggled at least once this session (confirmed:
      // a fresh `hyprctl workspaces -j` has no "special:*" entry) — so
      // unlike the numbered pips, its pip can't come and go with the
      // live list. It's built once below and always shown; only its
      // CONTENTS (what's stashed in it) are data-driven.
      const specialWs = allSpaces.find((w) => w.name?.startsWith("special"))
      const specialOwn = specialWs
        ? allClients.filter((c) => c.workspace?.id === specialWs.id)
        : []
      const specialClasses = dedupClasses(specialOwn.map((c) => c.class || c.initialClass || ""))

      return {
        items,
        special: {
          occupied: specialOwn.length > 0,
          active: f?.name?.startsWith("special") ?? false,
          icons: specialClasses.slice(0, MAX_ICONS).map(iconFor),
          overflow: Math.max(0, specialClasses.length - MAX_ICONS),
        },
      }
    },
  )

  return (
    <box
      class="WorkspaceRail"
      valign={Gtk.Align.CENTER}
      $={(self: Gtk.Box) => {
        // Built by hand rather than with <For>, for one reason:
        // ANIMATION. `state` emits a fresh object on every Hyprland
        // event, so a keyed list rebuilds every child every time — and
        // a widget that is destroyed and recreated cannot transition
        // anything. Its CSS starts at the final state. That is why the
        // rail never animated.
        //
        // Here a workspace's button is created once and then only has
        // its classes and contents updated, so `transition` and
        // `@keyframes` in the stylesheet actually fire, and they fire
        // on the real event (you switched workspace) instead of on
        // every unrelated client change.
        const built = new Map<number, { btn: Gtk.Button; shape: string }>()

        // Scroll anywhere over the rail to switch ±1 — the mouse-wheel
        // equivalent of `conf/binds.lua`'s SUPER+scroll (same direction:
        // down = next, up = previous), now reachable without a modifier
        // key just by being on the bar. DISCRETE coalesces a touchpad's
        // stream of tiny deltas into whole notches, so one physical
        // flick moves one workspace, not three — see
        // 09-bar-interaction-research.md's scroll-over-module writeup,
        // which flags this as the trap for a workspace/track target as
        // opposed to volume's fine-grained continuous case.
        const scroll = new Gtk.EventControllerScroll({
          flags:
            Gtk.EventControllerScrollFlags.VERTICAL |
            Gtk.EventControllerScrollFlags.DISCRETE,
        })
        scroll.connect("scroll", (_c, _dx, dy) => {
          goTo(`hl.dsp.focus({workspace="${dy > 0 ? "+1" : "-1"}"})`)
          return Gdk.EVENT_STOP
        })
        self.add_controller(scroll)

        // ── the scratchpad pip: one fixed button, not data-driven ──
        // No hover preview here (unlike the numbered pips) — there is
        // no live workspace to look up in WorkspacePreview.tsx before
        // it has ever been toggled open once. Click toggles it open;
        // dropping a window onto it stashes that window without also
        // snapping it open, matching conf/binds.lua's SUPER+SHIFT+S.
        const specialBtn = new Gtk.Button({ valign: Gtk.Align.CENTER })
        specialBtn.set_tooltip_text("Scratchpad")
        specialBtn.connect("clicked", () => goTo("hl.dsp.workspace.toggle_special({})"))

        const specialDrop = new Gtk.DropTarget({ actions: Gdk.DragAction.MOVE })
        specialDrop.set_gtypes([AstalHyprland.Client.$gtype])
        specialDrop.connect("enter", () => {
          specialBtn.set_tooltip_text("Move to Scratchpad")
          return Gdk.DragAction.MOVE
        })
        specialDrop.connect("leave", () => specialBtn.set_tooltip_text("Scratchpad"))
        specialDrop.connect("drop", (_t, client: AstalHyprland.Client) => {
          goTo(
            `hl.dsp.window.move({workspace="special", window="pid:${client.pid}", silent=true})`,
          )
          return true
        })
        specialBtn.add_controller(specialDrop)

        self.append(specialBtn)
        const specialEntry = { shape: "" }

        const sync = ({ items, special }: { items: Item[]; special: SpecialInfo }) => {
          let previous: Gtk.Widget | null = null

          for (const item of items) {
            let entry = built.get(item.id)

            if (!entry) {
              const btn = new Gtk.Button({ valign: Gtk.Align.CENTER })
              btn.set_tooltip_text(`Workspace ${item.id}`)
              btn.connect("clicked", () => goTo(item.lua))

              // See without switching. `item.id` is the stable key this
              // button was built for — it never changes across syncs,
              // even though a fresh `item` object arrives on every one.
              const motion = new Gtk.EventControllerMotion()
              motion.connect("enter", () => {
                setHoveredWorkspace(item.id)
                hoverEnter("workspace", btn)
              })
              motion.connect("leave", () => hoverLeave())
              btn.add_controller(motion)

              // Drop a window dragged out of the hover preview (see
              // WorkspacePreview.tsx's drag source on each client box)
              // onto a different pip to move it there.
              //
              // Deliberately does NOT call setHoveredWorkspace/hoverEnter
              // the way the pointer-hover path does. That was the first
              // version, and it was a real bug: the drag SOURCE is a
              // widget inside the workspace preview panel, and that
              // panel is a persistent, content-swapping singleton
              // (WorkspacePreview.tsx). Calling setHoveredWorkspace from
              // here re-renders it to a DIFFERENT workspace's tree —
              // destroying the very widget mid-drag. Confirmed live:
              // that produced 57 enter/leave pairs across four pips and
              // zero drops. A plain tooltip (what the old rice did here
              // too) gives the same "you're about to drop on N" feedback
              // without touching anything the drag depends on; the
              // `:drop(active)` CSS class (main.scss) already highlights
              // the pip itself with no JS involved.
              // Which half of the pip the pointer is over right now —
              // read by `drop`, kept live by `motion`. Defaults to
              // "right" so a drop that somehow lands without a prior
              // motion event still does something sane rather than
              // throwing on an unset value.
              let side: "l" | "r" = "r"

              const drop = new Gtk.DropTarget({ actions: Gdk.DragAction.MOVE })
              drop.set_gtypes([AstalHyprland.Client.$gtype])
              drop.connect("enter", () => {
                btn.set_tooltip_text(`Move to Workspace ${item.id}`)
                return Gdk.DragAction.MOVE
              })
              drop.connect("motion", (_t, x: number) => {
                const half = btn.get_width() / 2
                side = x < half ? "l" : "r"
                btn.set_css_classes(
                  [
                    item.occupied ? "ws" : "dot",
                    item.active ? "active" : "",
                    side === "l" ? "split-left" : "split-right",
                  ].filter(Boolean),
                )
                btn.set_tooltip_text(
                  side === "l"
                    ? `Split left of Workspace ${item.id}`
                    : `Split right of Workspace ${item.id}`,
                )
                return Gdk.DragAction.MOVE
              })
              drop.connect("leave", () => {
                btn.set_tooltip_text(`Workspace ${item.id}`)
                btn.remove_css_class("split-left")
                btn.remove_css_class("split-right")
              })
              drop.connect("drop", (_t, client: AstalHyprland.Client) => {
                goToSplit(side, item.id, client.pid)
                btn.remove_css_class("split-left")
                btn.remove_css_class("split-right")
                return true
              })
              btn.add_controller(drop)

              self.append(btn)
              entry = { btn, shape: "" }
              built.set(item.id, entry)
            }

            const { btn } = entry
            renderPipContent(btn, entry, item.occupied, item.icons, item.overflow)

            btn.set_css_classes(
              [item.occupied ? "ws" : "dot", item.active ? "active" : ""].filter(Boolean),
            )

            // Keyboard-triggered preview (SUPER+M, see conf/binds.lua's
            // "wsmap" submap and app.ts's "workspace-preview" request)
            // has no pointer to position from, unlike hover. Anchoring
            // to the currently active pip gives it a sensible default
            // spot instead of falling back to whatever anchorX was last
            // set to.
            if (item.active) registerAnchor("workspace", btn)

            // Workspaces can appear anywhere in the order (a new one
            // opens between two existing ones), so position is
            // reasserted every pass. Passing null moves it to the head.
            self.reorder_child_after(btn, previous)
            previous = btn
          }

          const live = new Set(items.map((i) => i.id))
          for (const [id, entry] of built) {
            if (live.has(id)) continue
            self.remove(entry.btn)
            built.delete(id)
          }

          // Always last — a drawer, not another numbered destination.
          renderPipContent(specialBtn, specialEntry, special.occupied, special.icons, special.overflow)
          specialBtn.set_css_classes(
            [special.occupied ? "ws" : "dot", "special", special.active ? "active" : ""].filter(
              Boolean,
            ),
          )
          self.reorder_child_after(specialBtn, previous)
        }

        sync(state.get())
        const unsubscribe = state.subscribe(() => sync(state.get()))
        onCleanup(() => unsubscribe())
      }}
    />
  )
}
