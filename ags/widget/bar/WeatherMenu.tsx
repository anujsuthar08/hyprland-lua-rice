import { Accessor, createComputed, For } from "ags"
import { Gtk } from "ags/gtk4"
import Menu from "./Menu"
import {
  chipIcon,
  chipTemp,
  daily,
  hasData,
  hasLocation,
  hourly,
  nowInfo,
  placeName,
  stale,
  updatedText,
} from "./weatherState"

// Forecast dropdown. Flat, on the one glass surface: a headline, a strip of the
// next hours, and the coming days separated by hairlines — no nested cards.
export function WeatherPanel() {
  return (
    <box class="Panel WeatherPanel" orientation={Gtk.Orientation.VERTICAL} spacing={10}>
      <box class="panel-head">
        <label class="panel-title" label={placeName} xalign={0} hexpand />
        <label class="dim" label={updatedText} />
      </box>

      {/* before the first fetch lands (or with no data at all) */}
      <label class="dim" xalign={0} label="Loading the forecast…" visible={createComputed([hasData], (d) => !d)} />

      <box orientation={Gtk.Orientation.VERTICAL} spacing={10} visible={hasData}>
        <box class="wx-now" spacing={12}>
          <image class="wx-icon" iconName={createComputed([nowInfo], (n) => n?.icon ?? "bar-cloud")} pixelSize={34} valign={Gtk.Align.CENTER} />
          <box orientation={Gtk.Orientation.VERTICAL} valign={Gtk.Align.CENTER} hexpand>
            <label class="wx-temp" xalign={0} label={createComputed([nowInfo], (n) => n?.temp ?? "")} />
            <label class="status" xalign={0} label={createComputed([nowInfo], (n) => n?.label ?? "")} />
          </box>
          <box orientation={Gtk.Orientation.VERTICAL} valign={Gtk.Align.CENTER}>
            <label class="value" xalign={1} label={createComputed([nowInfo], (n) => (n ? `H ${n.hi}` : ""))} />
            <label class="value" xalign={1} label={createComputed([nowInfo], (n) => (n ? `L ${n.lo}` : ""))} />
          </box>
        </box>

        <label
          class="dim"
          xalign={0}
          wrap
          label={createComputed([nowInfo], (n) => (n ? `Feels like ${n.feels}  ·  ${n.humidity} humidity  ·  ${n.wind}` : ""))}
        />

        <box class="wx-hours" homogeneous>
          <For each={hourly}>
            {(h: { label: string; icon: string; temp: string }) => (
              <box orientation={Gtk.Orientation.VERTICAL} spacing={4} halign={Gtk.Align.CENTER}>
                <label class="dim" label={h.label} />
                <image iconName={h.icon} pixelSize={16} />
                <label class="value" label={h.temp} />
              </box>
            )}
          </For>
        </box>

        <box class="wx-days" orientation={Gtk.Orientation.VERTICAL} spacing={4}>
          <For each={daily}>
            {(d: { day: string; icon: string; hi: string; lo: string; rain: string }) => (
              <box class="wx-day" spacing={10}>
                <label class="wx-dayname" xalign={0} label={d.day} widthChars={6} />
                <image iconName={d.icon} pixelSize={16} />
                <label class="dim" xalign={0} hexpand label={d.rain ? `${d.rain} rain` : ""} />
                <label class="value" label={`${d.hi}  ${d.lo}`} />
              </box>
            )}
          </For>
        </box>
      </box>
    </box>
  )
}

// A condition icon and the temperature, always visible (a glyph you have to
// hover to read is not information). Hidden entirely until a location has been
// set with scripts/weather-city.py — a chip that says nothing is clutter.
export default function WeatherMenu(props: { reveal: Accessor<boolean> }) {
  return (
    <revealer
      transitionType={Gtk.RevealerTransitionType.SLIDE_LEFT}
      transitionDuration={220}
      revealChild={createComputed([hasLocation, hasData], (l, d) => l && d)}
    >
      <Menu
        name="weather"
        icon={chipIcon}
        badge={chipTemp}
        extra={createComputed([stale], (s) => (s ? "stale" : ""))}
        reveal={props.reveal}
        tooltip="Weather"
      />
    </revealer>
  )
}
