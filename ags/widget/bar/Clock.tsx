import { Accessor, createComputed, createState } from "ags"
import { createPoll, timeout } from "ags/time"
import GLib from "gi://GLib"
import { Gtk } from "ags/gtk4"
import { hoverable, openDropdown, registerAnchor, toggleDropdown } from "./dropdown"

export default function Clock(props: { reveal: Accessor<boolean> }) {
  // %-I strips the leading zero; poll once a second so the minute never
  // lags behind the real clock. Split in two: the time is always shown,
  // the date only while the bar is expanded — that is the whole
  // "grows sideways" idea in miniature.
  // In-process (GLib.DateTime), not `date`: a subprocess every second was 86,400 process spawns a day.
  const stamp = () => GLib.DateTime.new_now_local().format("%a %d %b|%-I:%M|%p") ?? ""
  const now = createPoll(stamp(), 1000, stamp)
  const date = createComputed([now], (s) => s.split("|")[0] ?? "")
  const time = createComputed([now], (s) => s.split("|")[1] ?? "")
  // AM/PM is not part of the number. Setting it a size down and a
  // shade back leaves the digits as the only thing the eye has to
  // resolve, and is the difference between a clock that was typeset
  // and a clock that was printf'd.
  const meridiem = createComputed([now], (s) => (s.split("|")[2] ?? "").toLowerCase())

  // A flourish tied to a REAL event (the minute actually changing),
  // not decoration — GNOME's system-status rule is "don't change more
  // than once a second", and this changes at most once a MINUTE. Skips
  // the very first tick (lastMinute starts unset) so the clock doesn't
  // flash the instant the bar is built.
  const [ticking, setTicking] = createState(false)
  let lastMinute = ""
  time.subscribe(() => {
    const t = time.get()
    if (lastMinute && t !== lastMinute) {
      setTicking(true)
      timeout(400, () => setTicking(false))
    }
    lastMinute = t
  })
  const timeClass = createComputed([ticking], (t) => (t ? "time tick" : "time"))

  return (
    <button
      class={createComputed([openDropdown], (o) =>
        o === "calendar" ? "Clock open" : "Clock",
      )}
      onClicked={(self: Gtk.Button) => toggleDropdown("calendar", self)}
      $={(self: Gtk.Button) => {
        registerAnchor("calendar", self)
        hoverable("calendar", self)
      }}
    >
      <box>
        <revealer
          transitionType={Gtk.RevealerTransitionType.SLIDE_RIGHT}
          transitionDuration={220}
          revealChild={props.reveal}
        >
          <label class="date" label={date} valign={Gtk.Align.BASELINE} />
        </revealer>

        {/* BASELINE, not CENTER — two different font sizes sharing a
            box default to centring on each other's midpoint, which is
            why "pm" used to float above the digits' true baseline
            instead of sitting on the line with them. */}
        <label class={timeClass} label={time} valign={Gtk.Align.BASELINE} />
        <label class="meridiem" label={meridiem} valign={Gtk.Align.BASELINE} />
      </box>
    </button>
  )
}
