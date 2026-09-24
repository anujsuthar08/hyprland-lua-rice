import { Accessor, createBinding, createComputed, For } from "ags"
import { Gtk } from "ags/gtk4"
import { createPoll } from "ags/time"
import AstalNotifd from "gi://AstalNotifd?version=0.1"
import Menu from "./Menu"
import { CLEAR_ALL, CLOSE, notificationIcon } from "./icons"

// Notification history and Do Not Disturb.
//
// The shell has had a notification DAEMON since the rebuild, but no way
// to see anything it had already shown: a popup timed out after five
// seconds and the notification was gone for good. That is the single
// biggest daily-use gap in the bar — every desktop that gets used for
// real has a place where the last twenty notifications still are.
//
// Both this panel and the popups in widget/Notifications.tsx read the
// same AstalNotifd, so dismissing here removes the popup and vice
// versa; `resolved` keeps the two in step without either of them
// knowing about the other.

const notifd = AstalNotifd.get_default()

function ago(unix: number, nowMs: number = Date.now()): string {
  const secs = Math.max(0, Math.floor(nowMs / 1000 - unix))
  if (secs < 60) return "now"
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}d`
}

function clamp(s: string, n: number) {
  const t = (s ?? "").replace(/\s+/g, " ").trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

// Shared tick so the "3m" labels age while the panel is open. createPoll
// only runs its timer while something is subscribed, so it costs nothing
// when the panel is closed.
const tick = createPoll(Date.now(), 30_000, () => Date.now())

function Row(n: AstalNotifd.Notification) {
  return (
    <box class={`note ${n.urgency === AstalNotifd.Urgency.CRITICAL ? "critical" : ""}`}>
      {n.image ? (
        <image class="thumb" file={n.image} pixelSize={28} valign={Gtk.Align.START} />
      ) : (
        <box />
      )}

      <box orientation={Gtk.Orientation.VERTICAL} hexpand>
        <box>
          <label class="app" label={clamp(n.appName ?? "", 22)} xalign={0} hexpand />
          <label class="when" label={tick((t) => ago(Number(n.time), t))} />
        </box>

        <label class="summary" label={clamp(n.summary ?? "", 40)} xalign={0} />

        {n.body ? (
          <label class="body" label={clamp(n.body, 76)} xalign={0} wrap />
        ) : (
          <box />
        )}
      </box>

      <button class="dismiss" valign={Gtk.Align.START} onClicked={() => n.dismiss()}>
        <image iconName={CLOSE} pixelSize={12} />
      </button>
    </box>
  )
}

export function NotificationPanel() {
  // `notifications` is a real GObject property, so this updates on both
  // arrival and dismissal without touching the `notified`/`resolved`
  // signals the popups use.
  const list = createComputed([createBinding(notifd, "notifications")], (l) =>
    [...(l ?? [])].sort((a, b) => Number(b.time) - Number(a.time)),
  )
  const dnd = createBinding(notifd, "dontDisturb")
  const count = createComputed([list], (l) => l.length)

  return (
    <box class="Panel NotificationPanel" orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      <box class="panel-head" spacing={6}>
        <label class="panel-title" label="Notifications" xalign={0} hexpand />

        <button
          class={createComputed([dnd], (d) => `chip ${d ? "on" : ""}`)}
          tooltipText="Do not disturb"
          onClicked={() => { notifd.dontDisturb = !notifd.dontDisturb }}
        >
          <image iconName={createComputed([dnd], notificationIcon)} pixelSize={15} />
        </button>

        <button
          class="chip"
          tooltipText="Clear all"
          onClicked={() => {
            // Copy first: dismiss() mutates the daemon's list, and
            // iterating the live array skips every other entry.
            for (const n of [...notifd.notifications]) n.dismiss()
          }}
        >
          <image iconName={CLEAR_ALL} pixelSize={15} />
        </button>
      </box>

      <Gtk.ScrolledWindow
        class="note-scroll"
        hscrollbarPolicy={Gtk.PolicyType.NEVER}
        propagateNaturalHeight
        maxContentHeight={300}
      >
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
          <For each={list}>{(n: AstalNotifd.Notification) => Row(n)}</For>
        </box>
      </Gtk.ScrolledWindow>

      {/* The empty state is the one a well-behaved desktop is in most
          of the time, so it gets a real line rather than a blank box. */}
      <label
        class="dim"
        label={createComputed([count, dnd], (c, d) =>
          c > 0 ? "" : d ? "Notifications silenced" : "Nothing new",
        )}
        visible={createComputed([count], (c) => c === 0)}
      />
    </box>
  )
}

export default function NotificationMenu(props: { reveal: Accessor<boolean> }) {
  const list = createBinding(notifd, "notifications")
  const dnd = createBinding(notifd, "dontDisturb")

  const count = createComputed([list], (l) => (l ?? []).length)

  return (
    <Menu
      name="notifications"
      icon={createComputed([dnd], notificationIcon)}
      // The count is always on: a bell with nothing beside it is a
      // button, a bell with a 3 beside it is information.
      badge={createComputed([count], (c) => (c > 0 ? String(c) : ""))}
      extra={createComputed([dnd, count], (d, c) =>
        [c > 0 && "unread", d && "silenced"].filter(Boolean).join(" "),
      )}
      reveal={props.reveal}
      tooltip="Notifications"
    />
  )
}
