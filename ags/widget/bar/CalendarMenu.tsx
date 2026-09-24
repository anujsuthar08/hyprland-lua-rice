import { createComputed, createState, For } from "ags"
import { interval } from "ags/time"
import GLib from "gi://GLib"
import { Gtk } from "ags/gtk4"
import { openDropdown } from "./dropdown"
import { nowInfo } from "./weatherState"

// Calendar dropdown. Design notes (researched, not invented):
//  * GNOME HIG: popovers stay small and low in complexity; GNOME's own redesign
//    concept puts the date + weather in one block above the month grid.
//  * Itsycal (the macOS menu-bar calendar) is the reference for the grid: weeks start
//    on Monday, ISO week numbers in a dim gutter, other-month days dimmed, today marked.
// No events: this desktop has no calendar backend, and a panel that promises
// events it cannot show is worse than one that does not.

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

// ISO 8601 week number: the week containing this date's Thursday.
function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dow = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - dow)
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7)
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

// ── world clocks (scripts/worldclock.py owns the list) ────────────────────────────
// Row layout follows GNOME Clocks: city, its time, a "Tomorrow"/"Yesterday" marker when the
// date differs from yours, and how far ahead or behind it is. Empty list = no section at all.
type City = { name: string; tz: string }
type ClockRow = { name: string; time: string; day: string; diff: string }
const CLOCK_FILE = `${GLib.get_user_state_dir()}/hypr-shell/worldclock.json`

function readCities(): City[] {
  try {
    const [ok, b] = GLib.file_get_contents(CLOCK_FILE)
    const d = ok ? JSON.parse(new TextDecoder().decode(b)) : []
    return Array.isArray(d) ? d.filter((c) => c && typeof c.tz === "string") : []
  } catch {
    return []
  }
}

function clockRows(cities: City[]): ClockRow[] {
  const here = GLib.DateTime.new_now_local()
  return cities.flatMap((c) => {
    const tz = GLib.TimeZone.new_identifier(c.tz)
    if (!tz) return [] // a zone this system does not know: skip it rather than show a wrong time
    const t = GLib.DateTime.new_now(tz)
    const days = Math.round(
      (Date.UTC(t.get_year(), t.get_month() - 1, t.get_day_of_month()) -
        Date.UTC(here.get_year(), here.get_month() - 1, here.get_day_of_month())) / 86400000)
    const hrs = (t.get_utc_offset() - here.get_utc_offset()) / 3_600_000_000
    const abs = Math.abs(hrs)
    const amount = abs < 1 ? `${Math.round(abs * 60)} min`
      : Number.isInteger(abs) ? `${abs} h` : `${Math.floor(abs)}:${String(Math.round((abs % 1) * 60)).padStart(2, "0")} h`
    return [{
      name: c.name || c.tz,
      time: t.format("%-I:%M %P") ?? "",
      day: days === 0 ? "" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday" : t.format("%a") ?? "",
      diff: hrs === 0 ? "same time" : `${amount} ${hrs > 0 ? "ahead" : "behind"}`,
    }]
  })
}

const [clocks, setClocks] = createState<ClockRow[]>(clockRows(readCities()))
const refreshClocks = () => setClocks(clockRows(readCities()))
interval(30_000, refreshClocks) // keeps minutes honest and picks up `worldclock.py add`

export function CalendarPanel() {
  // months away from the current one (0 = this month)
  const [offset, setOffset] = createState(0)
  const [today, setToday] = createState(new Date())

  // Coming back to the panel always starts on today, and picks up a date change
  // that happened while the shell kept running past midnight.
  openDropdown.subscribe(() => {
    if (openDropdown.get() === "calendar") {
      refreshClocks()
      setToday(new Date())
      setOffset(0)
    }
  })

  const view = createComputed([offset, today], (o, t) => new Date(t.getFullYear(), t.getMonth() + o, 1))

  // 6 rows x (week number + 7 days) of labels built once and re-filled on change,
  // so paging months never creates or destroys widgets.
  const grid = new Gtk.Grid({ columnSpacing: 2, rowSpacing: 2, halign: Gtk.Align.CENTER })
  grid.add_css_class("cal-grid")
  DAYS.forEach((d, c) => {
    const l = new Gtk.Label({ label: d, widthChars: 4 })
    l.add_css_class("cal-dow")
    grid.attach(l, c + 1, 0, 1, 1)
  })
  const wk: Gtk.Label[] = []
  const cells: Gtk.Label[] = []
  for (let r = 0; r < 6; r++) {
    const w = new Gtk.Label({ widthChars: 3 })
    w.add_css_class("cal-week")
    grid.attach(w, 0, r + 1, 1, 1)
    wk.push(w)
    for (let c = 0; c < 7; c++) {
      const l = new Gtk.Label({ widthChars: 4 })
      l.add_css_class("cal-day")
      grid.attach(l, c + 1, r + 1, 1, 1)
      cells.push(l)
    }
  }

  const fill = () => {
    const v = view.get()
    const t = today.get()
    const lead = (v.getDay() + 6) % 7 // Monday-first column of the 1st
    const start = new Date(v.getFullYear(), v.getMonth(), 1 - lead)
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
      const l = cells[i]
      l.set_label(String(d.getDate()))
      l.remove_css_class("other")
      l.remove_css_class("today")
      l.remove_css_class("weekend")
      if (d.getMonth() !== v.getMonth()) l.add_css_class("other")
      else if (d.getDay() === 0 || d.getDay() === 6) l.add_css_class("weekend")
      if (sameDay(d, t)) l.add_css_class("today")
    }
    for (let r = 0; r < 6; r++) {
      const monday = new Date(start.getFullYear(), start.getMonth(), start.getDate() + r * 7)
      wk[r].set_label(String(isoWeek(monday)))
    }
  }
  view.subscribe(fill)
  fill()

  const heading = createComputed([view], (v) => `${MONTHS[v.getMonth()]} ${v.getFullYear()}`)
  const bigDay = createComputed([today], (t) => t.toLocaleDateString("en", { weekday: "long" }))
  const bigDate = createComputed([today], (t) =>
    `${t.getDate()} ${MONTHS[t.getMonth()]} ${t.getFullYear()}  ·  week ${isoWeek(t)}`)
  const wx = createComputed([nowInfo], (n) => (n ? `${n.temp}  ${n.label}` : ""))

  return (
    <box class="Panel CalendarPanel" orientation={Gtk.Orientation.VERTICAL} spacing={10}>
      <box class="cal-head" spacing={10}>
        <box orientation={Gtk.Orientation.VERTICAL} hexpand>
          <label class="cal-bigday" xalign={0} label={bigDay} />
          <label class="dim" xalign={0} label={bigDate} />
        </box>
        <label class="value" valign={Gtk.Align.CENTER} label={wx} visible={createComputed([wx], (s) => s !== "")} />
      </box>

      <box class="cal-nav" spacing={4}>
        <button class="cal-arrow" tooltipText="Previous month" onClicked={() => setOffset((o) => o - 1)}>
          <label label="‹" />
        </button>
        <label class="cal-month" label={heading} hexpand />
        <button class="cal-arrow" tooltipText="Next month" onClicked={() => setOffset((o) => o + 1)}>
          <label label="›" />
        </button>
      </box>

      {grid}

      <box class="cal-clocks" orientation={Gtk.Orientation.VERTICAL} spacing={4}
        visible={createComputed([clocks], (c) => c.length > 0)}>
        <For each={clocks}>
          {(r: ClockRow) => (
            <box class="cal-clock" spacing={8}>
              <label class="cal-cname" xalign={0} hexpand ellipsize={3} label={r.name} />
              <label class="dim" label={[r.day, r.diff].filter(Boolean).join(" · ")} />
              <label class="value cal-ctime" xalign={1} label={r.time} />
            </box>
          )}
        </For>
      </box>

      <button
        class="cal-today"
        visible={createComputed([offset], (o) => o !== 0)}
        onClicked={() => setOffset(0)}
      >
        <label label="Back to today" />
      </button>
    </box>
  )
}
