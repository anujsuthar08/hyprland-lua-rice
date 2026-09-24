import { createBinding, createComputed, With } from "ags"
import { Gtk } from "ags/gtk4"
import AstalBattery from "gi://AstalBattery?version=0.1"
import { hoverable, openDropdown, registerAnchor, toggleDropdown } from "./dropdown"
import { batteryIcon } from "./icons"
import CrossfadeIcon from "./CrossfadeIcon"
import { canWrite, health, LIMIT, limit, limitOn, setChargeLimit, supportsLimit } from "./batteryCare"

// "2h 40m", from UPower's seconds. Zero means "not estimated yet",
// which happens for the first minute or so after plugging in or out —
// saying nothing is better than saying "0m".
function duration(secs: number): string {
  if (!secs || secs <= 0) return ""
  const mins = Math.round(secs / 60)
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

// What the panel says, as a pure function of the battery's state.
// Driving it off `charging` alone left two states stuck on "estimating…"
// forever: FULLY_CHARGED (charging is false and both estimates are 0) and
// PENDING_CHARGE (plugged in but held back, e.g. by a charge threshold).
export function describeBattery(
  state: AstalBattery.State,
  percent: number,
  toEmpty: number,
  toFull: number,
): { headline: string; remaining: string } {
  const pct = `${Math.round(percent * 100)}%`
  switch (state) {
    case AstalBattery.State.CHARGING: {
      const d = duration(toFull)
      return { headline: `${pct} · charging`, remaining: d ? `${d} until full` : "estimating…" }
    }
    case AstalBattery.State.FULLY_CHARGED:
      return { headline: `${pct} · full`, remaining: "Fully charged" }
    case AstalBattery.State.PENDING_CHARGE:
      return { headline: `${pct} · plugged in`, remaining: "Plugged in, not charging" }
    case AstalBattery.State.EMPTY:
      return { headline: pct, remaining: "Battery empty" }
    default: {
      const d = duration(toEmpty)
      return { headline: pct, remaining: d ? `${d} remaining` : "estimating…" }
    }
  }
}

export function BatteryPanel() {
  const bat = AstalBattery.get_default()

  const percent = createBinding(bat, "percentage")
  const charging = createBinding(bat, "charging")
  const state = createBinding(bat, "state")
  const toEmpty = createBinding(bat, "timeToEmpty")
  const toFull = createBinding(bat, "timeToFull")
  const rate = createBinding(bat, "energyRate")

  const text = createComputed([state, percent, toEmpty, toFull], (st, p, e, f) =>
    describeBattery(st, p, Number(e), Number(f)),
  )
  const headline = createComputed([text], (t) => t.headline)
  const remaining = createComputed([text], (t) => t.remaining)

  return (
    <box class="Panel BatteryPanel" orientation={Gtk.Orientation.VERTICAL} spacing={8}>
      <box class="panel-head">
        <label class="panel-title" label="Battery" xalign={0} hexpand />
        <label class="value" label={headline} />
      </box>

      <levelbar
        class="charge"
        value={createComputed([percent], (p) => Math.max(0, Math.min(1, p)))}
      />

      <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
        <label class="status" label={remaining} xalign={0} />
        <label
          class="dim"
          xalign={0}
          label={createComputed([rate, charging, state], (r, c, st) =>
            r > 0 && st !== AstalBattery.State.FULLY_CHARGED && st !== AstalBattery.State.PENDING_CHARGE
              ? `${r.toFixed(1)} W ${c ? "in" : "draw"}`
              : "",
          )}
        />
      </box>

      {/* battery care: wear, and the 80 % charge limit */}
      <box class="care" orientation={Gtk.Orientation.VERTICAL} spacing={6}
        visible={createComputed([health, supportsLimit], (h, l) => h !== null || l)}>
        <box visible={createComputed([health], (h) => h !== null)}>
          <label class="status" xalign={0} hexpand label="Battery health" />
          <label class="value" label={createComputed([health], (h) => (h === null ? "" : `${h}%`))} />
        </box>
        <box visible={supportsLimit} spacing={8}>
          <label class="status" xalign={0} hexpand label={`Limit charge to ${LIMIT}%`} />
          <switch
            valign={Gtk.Align.CENTER}
            sensitive={canWrite}
            active={limitOn}
            onStateSet={(_s: Gtk.Switch, state: boolean) => { setChargeLimit(state); return false }}
          />
        </box>
        <label class="dim" xalign={0} wrap maxWidthChars={34}
          visible={createComputed([supportsLimit, canWrite], (s, w) => s && !w)}
          label="Needs a one-time setup: sudo ~/.config/hypr/scripts/battery-limit-setup.sh --apply" />
      </box>
    </box>
  )
}

export default function Battery() {
  const bat = AstalBattery.get_default()
  if (!bat) return <box />

  const isBattery = createBinding(bat, "isBattery")
  const percent = createBinding(bat, "percentage")
  const charging = createBinding(bat, "charging")

  const klass = createComputed([percent, charging, openDropdown], (p, c, o) =>
    [
      "Battery",
      c ? "charging" : p <= 0.2 ? "low" : "",
      o === "battery" ? "open" : "",
    ]
      .filter(Boolean)
      .join(" "),
  )

  // desktops report no battery — render nothing at all there
  return (
    <With value={isBattery}>
      {(has) =>
        has ? (
          <button
            class={klass}
            tooltipText="Battery"
            onClicked={(self: Gtk.Button) => toggleDropdown("battery", self)}
            $={(self: Gtk.Button) => {
              registerAnchor("battery", self)
              hoverable("battery", self)
            }}
          >
            <box>
              <CrossfadeIcon
                iconName={createComputed([percent, charging], batteryIcon)}
                pixelSize={18}
              />
              {/* Number and unit are separate labels so the "%" can
                  sit a size down and a shade back. It is the same
                  trick as the clock's am/pm: the digits are what you
                  read, the unit is only there to say what they are. */}
              <label
                class="value"
                valign={Gtk.Align.BASELINE}
                label={createComputed([percent], (p) => `${Math.round(p * 100)}`)}
              />
              <label class="unit" valign={Gtk.Align.BASELINE} label="%" />
            </box>
          </button>
        ) : (
          <box />
        )
      }
    </With>
  )
}
