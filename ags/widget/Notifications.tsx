import app from "ags/gtk4/app"
import { Astal, Gdk, Gtk } from "ags/gtk4"
import { For, createComputed, createState, onCleanup } from "ags"
import AstalNotifd from "gi://AstalNotifd?version=0.1"

const TIMEOUT = 5000

function NotificationCard(n: AstalNotifd.Notification, dismiss: () => void) {
  const critical = n.urgency === AstalNotifd.Urgency.CRITICAL

  return (
    <box orientation={Gtk.Orientation.VERTICAL} class={`Notification ${critical ? "critical" : ""}`}>
      <box>
        <label class="app-name" label={n.appName ?? ""} hexpand halign={Gtk.Align.START} />
        <button onClicked={dismiss}>
          <image iconName="window-close-symbolic" pixelSize={12} />
        </button>
      </box>

      <box>
        {n.image ? <image file={n.image} pixelSize={48} /> : <box />}
        <box orientation={Gtk.Orientation.VERTICAL} hexpand>
          <label class="summary" label={n.summary ?? ""} xalign={0} wrap />
          <label class="body" label={n.body ?? ""} xalign={0} wrap />
        </box>
      </box>

      {n.actions.length > 0 ? (
        <box class="actions">
          {n.actions.map((a) => (
            <button onClicked={() => n.invoke(a.id)}>
              <label label={a.label} />
            </button>
          ))}
        </box>
      ) : (
        <box />
      )}
    </box>
  )
}

export default function NotificationPopups(gdkmonitor: Gdk.Monitor) {
  const notifd = AstalNotifd.get_default()
  const { TOP, RIGHT } = Astal.WindowAnchor

  const [list, setList] = createState<AstalNotifd.Notification[]>([])

  // One timer per id. A replaced notification (progress/volume style
  // updates reuse the id) must restart its timeout: the old timer would
  // otherwise close the fresh popup early, and a `!replaced` guard would
  // leave it with no timer at all.
  const timers = new Map<number, ReturnType<typeof setTimeout>>()

  const remove = (id: number) => {
    const t = timers.get(id)
    if (t !== undefined) clearTimeout(t)
    timers.delete(id)
    setList((prev) => prev.filter((n) => n.id !== id))
  }

  // `notified` fires for new notifications; `resolved` when one is
  // closed elsewhere (dismissed by the app, or via the history panel).
  const onNotified = notifd.connect("notified", (_, id, replaced) => {
    const n = notifd.get_notification(id)
    if (!n) return

    // Do Not Disturb, toggled from the bar's notification panel.
    // AstalNotifd only STORES the flag — it still hands every
    // notification to us — so suppressing the popup is our job. The
    // notification is still recorded, so it is waiting in the panel
    // afterwards; critical ones come through regardless, which is the
    // whole point of the urgency being critical.
    if (notifd.dontDisturb && n.urgency !== AstalNotifd.Urgency.CRITICAL) return

    setList((prev) => [n, ...prev.filter((p) => p.id !== id)])

    const old = timers.get(id)
    if (old !== undefined) clearTimeout(old)
    timers.delete(id)

    if (n.urgency !== AstalNotifd.Urgency.CRITICAL) {
      // critical notifications stay until acted on
      timers.set(id, setTimeout(() => remove(id), TIMEOUT))
    }
  })

  const onResolved = notifd.connect("resolved", (_, id) => remove(id))

  onCleanup(() => {
    notifd.disconnect(onNotified)
    notifd.disconnect(onResolved)
    timers.forEach(clearTimeout)
    timers.clear()
  })

  // GTK4/layer-shell only repaints a surface when its content actually
  // changes size. Once the last card is removed, the box goes to 0x0
  // but a fixed-size TOP|RIGHT window with nothing to redraw can leave
  // the compositor showing the LAST COMMITTED FRAME — the dismissed
  // notification stays on screen as a frozen image, still fully
  // readable, with nothing behind it responding to clicks. Verified:
  // hyprctl layers kept the popup's geometry pinned to its last
  // non-empty size long after the list had actually emptied (confirmed
  // separately via debug logging — the state was correct, only the
  // surface was stale). Tying `visible` to whether there is anything to
  // show forces an unmap when empty and a fresh map on the next
  // notification, so there is never a stale frame to get stuck on.
  const hasNotifications = createComputed(() => list().length > 0)

  return (
    <window
      visible={hasNotifications}
      name="notifications"
      namespace="notifications"
      class="NotificationPopups hypr-shell"
      gdkmonitor={gdkmonitor}
      exclusivity={Astal.Exclusivity.NORMAL}
      anchor={TOP | RIGHT}
      application={app}
    >
      <box orientation={Gtk.Orientation.VERTICAL}>
        <For each={list}>
          {(n) => NotificationCard(n, () => { n.dismiss(); remove(n.id) })}
        </For>
      </box>
    </window>
  )
}
