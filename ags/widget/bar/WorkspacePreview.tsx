import { createBinding, createComputed, With } from "ags"
import { Gdk, Gtk } from "ags/gtk4"
import GObject from "ags/gobject"
import AstalHyprland from "gi://AstalHyprland?version=0.1"
import { iconFor } from "./appIcon"
import { hoveredWorkspace, setDragActive } from "./dropdown"

// "What's on workspace 4" without going there. Hovering a rail button
// sets `hoveredWorkspace` (see WorkspaceRail.tsx); this panel rebuilds
// a little floorplan of that workspace's real tiling from client
// geometry, the same way the pre-rebuild rice did
// (~/.config/ags.bak-20260830-222641/.../WorkspaceOverview.tsx) — ported
// rather than reinvented. Each client box is also a drag source, so a
// window can be dragged out of this floorplan onto a different rail
// pip to move it there (WorkspaceRail.tsx has the drop target).

// Fits inside the dropdown's 276px content width (PANEL_WIDTH 300 minus
// the `.Dropdown` card's 12px padding on each side).
const MAP_WIDTH = 252

type Node =
  | { type: "leaf"; client: AstalHyprland.Client }
  | { type: "vsplit" | "hsplit"; a: Node; b: Node }

// Reconstructs the tiling tree from where the windows actually ARE —
// Hyprland doesn't expose its layout tree over IPC, only each client's
// x/y/width/height, so this works backwards from geometry: find an x
// (or y) that cleanly separates every client into two non-overlapping
// groups, and recurse. The `+ 5` / `- 5` slop absorbs gap_in/out so a
// gapped layout still finds the same separator a gapless one would.
function buildTree(clients: AstalHyprland.Client[]): Node {
  if (clients.length === 1) return { type: "leaf", client: clients[0] }

  const xs = [...new Set(clients.flatMap((c) => [c.x, c.x + c.width]))].sort((a, b) => a - b)
  for (const x of xs) {
    const left = clients.filter((c) => c.x + c.width <= x + 5)
    const right = clients.filter((c) => c.x >= x - 5)
    if (left.length && right.length && left.length + right.length === clients.length) {
      return { type: "vsplit", a: buildTree(left), b: buildTree(right) }
    }
  }

  const ys = [...new Set(clients.flatMap((c) => [c.y, c.y + c.height]))].sort((a, b) => a - b)
  for (const y of ys) {
    const top = clients.filter((c) => c.y + c.height <= y + 5)
    const bot = clients.filter((c) => c.y >= y - 5)
    if (top.length && bot.length && top.length + bot.length === clients.length) {
      return { type: "hsplit", a: buildTree(top), b: buildTree(bot) }
    }
  }

  // No clean separator (overlapping floats, an odd layout) — fall back
  // to the biggest window rather than drawing something wrong.
  const main = [...clients].sort((a, b) => b.width * b.height - a.width * a.height)[0]
  return { type: "leaf", client: main }
}

function renderNode(node: Node, focusedAddress: string | null): Gtk.Widget {
  if (node.type === "leaf") {
    const c = node.client
    const cls = c.class || c.initialClass || ""
    const icon = iconFor(cls)
    return (
      <box
        class={`preview-client ${c.address === focusedAddress ? "focused" : ""}`}
        tooltipText={`Drag to move · ${c.title || cls}`}
        hexpand
        vexpand
        $={(self: Gtk.Widget) => {
          // Drag this window onto a different rail pip to move it there
          // (WorkspaceRail.tsx has the matching drop target). The
          // content is the live Hyprland client object itself, not
          // just its pid — the drop side only needs the pid, but
          // passing the object is what lets GTK type-check the drag
          // against the drop target's declared gtype instead of
          // accepting any GObject.
          const source = new Gtk.DragSource({ actions: Gdk.DragAction.MOVE })

          source.connect("prepare", () => {
            const value = new GObject.Value()
            value.init(AstalHyprland.Client.$gtype)
            value.set_object(c)
            return Gdk.ContentProvider.new_for_value(value)
          })

          source.connect("drag-begin", () => {
            // Freezes this panel's content and its close-on-leave timer
            // for the drag's duration — see dropdown.ts's `dragActive`
            // comment for why: without it, dragging over a DIFFERENT
            // pip rebuilds THIS panel (via the old hoveredWorkspace-
            // swap the drop target used to trigger), destroying the
            // very widget mid-drag. Confirmed live: that bug produced
            // 57 enter/leave pairs and zero drops.
            setDragActive(true)

            const theme = Gtk.IconTheme.get_for_display(self.get_display())
            const paintable = theme.lookup_icon(
              icon,
              null,
              24,
              1,
              Gtk.TextDirection.NONE,
              0,
            )
            if (paintable) source.set_icon(paintable, 12, 12)
          })

          source.connect("drag-end", () => {
            setDragActive(false)
          })

          source.connect("drag-cancel", () => {
            setDragActive(false)
            return false
          })

          self.add_controller(source)
        }}
      >
        <image
          iconName={icon}
          pixelSize={16}
          halign={Gtk.Align.CENTER}
          valign={Gtk.Align.CENTER}
          hexpand
          vexpand
        />
      </box>
    ) as Gtk.Widget
  }

  const orientation =
    node.type === "vsplit" ? Gtk.Orientation.HORIZONTAL : Gtk.Orientation.VERTICAL

  return (
    <box orientation={orientation} spacing={2} homogeneous hexpand vexpand>
      {renderNode(node.a, focusedAddress)}
      {renderNode(node.b, focusedAddress)}
    </box>
  ) as Gtk.Widget
}

export default function WorkspacePreview() {
  const hypr = AstalHyprland.get_default()

  const clients = createBinding(hypr, "clients")
  const spaces = createBinding(hypr, "workspaces")
  const focusedClient = createBinding(hypr, "focusedClient")

  const view = createComputed(
    [hoveredWorkspace, clients, spaces, focusedClient],
    (id, allClients, allSpaces, focused) => {
      if (id === null) return null

      const ws = allSpaces.find((w) => w.id === id) ?? null
      const own = allClients.filter((c) => (c.workspace?.id ?? -1) === id)
      const mon = ws?.monitor
      // Scaled from the REAL monitor, not a hardcoded resolution — a
      // 16:10 external display would otherwise draw a 16:9 floorplan.
      const scale = MAP_WIDTH / (mon?.width || 1920)

      return {
        name: ws?.name ?? String(id),
        clients: own,
        focusedAddress: focused?.address ?? null,
        mapHeight: Math.round((mon?.height || 1080) * scale),
      }
    },
  )

  return (
    <box class="Panel WorkspacePreview" orientation={Gtk.Orientation.VERTICAL} spacing={6}>
      <With value={view}>
        {(v) =>
          v ? (
            <box orientation={Gtk.Orientation.VERTICAL} spacing={6}>
              <label class="panel-title" label={`Workspace ${v.name}`} xalign={0} />
              {v.clients.length === 0 ? (
                <label class="dim" label="Empty" xalign={0} />
              ) : (
                <box class="map" widthRequest={MAP_WIDTH} heightRequest={v.mapHeight}>
                  {renderNode(buildTree(v.clients), v.focusedAddress)}
                </box>
              )}
            </box>
          ) : (
            <label class="dim" label="Hover a workspace" xalign={0} />
          )
        }
      </With>
    </box>
  )
}
