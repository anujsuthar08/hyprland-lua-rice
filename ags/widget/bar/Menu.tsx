import { Accessor, createComputed, With } from "ags"
import { Gtk } from "ags/gtk4"
import {
  DropdownName,
  hoverable,
  openDropdown,
  registerAnchor,
  toggleDropdown,
} from "./dropdown"
import CrossfadeIcon from "./CrossfadeIcon"

// A status glyph that opens a dropdown. The dropdown itself lives in
// BarDropdown.tsx — see dropdown.ts for why it is a separate layer
// window and not a GtkPopover.
export default function Menu(props: {
  name: DropdownName
  // A SYMBOLIC ICON NAME, not a glyph — see bar/icons.ts for why.
  icon: Accessor<string> | string
  // Spelled-out value (62%, an SSID, a track name) shown only while the
  // bar is expanded — at rest a glyph alone carries the state.
  value?: Accessor<string> | string
  // Re-create the value label on each change so it eases in — opt-in,
  // because a volume % scrubbing would replay it every tick.
  animateValue?: boolean
  // Shown at ALL times, not just while the bar is expanded — for state
  // you need without asking for it: an unread count, a battery
  // percentage. Keep it to a few characters.
  badge?: Accessor<string> | string
  reveal?: Accessor<boolean>
  // Extra classes on the button (a battery going low, a bell holding
  // unread notifications) merged with `glyph` and `open`.
  extra?: Accessor<string>
  tooltip?: string
  // Extra controllers on the button — volume wants scroll-to-adjust.
  setup?: (self: Gtk.Button) => void
  // For a glyph backed by an optional package (PhoneMenu.tsx / Valent):
  // hidden, not unmounted, so it can't land at the end of the cluster —
  // see VpnIndicator.tsx's comment on the <With>-remount bug this avoids.
  visible?: Accessor<boolean> | boolean
}) {
  const { name, icon, value, animateValue, badge, reveal, tooltip, setup, extra, visible } = props

  const klass = extra
    ? createComputed([openDropdown, extra], (o, x) =>
        ["glyph", o === name && "open", x].filter(Boolean).join(" "),
      )
    : createComputed([openDropdown], (o) => (o === name ? "glyph open" : "glyph"))

  return (
    <button
      class={klass}
      visible={visible ?? true}
      tooltipMarkup={tooltip ?? ""}
      onClicked={(self: Gtk.Button) => toggleDropdown(name, self)}
      $={(self: Gtk.Button) => {
        registerAnchor(name, self)
        hoverable(name, self)
        setup?.(self)
      }}
    >
      <box class="glyph-body" valign={Gtk.Align.CENTER}>
        {/* An image, so it is centred in a box rather than sat on a
            text baseline — which is what kept the old glyphs a pixel
            or two off the line beside their own labels. Crossfades
            between icon names instead of snapping — see
            CrossfadeIcon.tsx. */}
        <CrossfadeIcon iconName={icon} pixelSize={20} />

        {badge !== undefined ? <label class="badge" label={badge} /> : <box />}

        {value !== undefined ? (
          <revealer
            transitionType={Gtk.RevealerTransitionType.SLIDE_RIGHT}
            transitionDuration={220}
            revealChild={reveal ?? false}
          >
            {animateValue && typeof value !== "string" ? (
              <With value={value}>
                {(v: string) => <label class="value swap" label={v} valign={Gtk.Align.CENTER} />}
              </With>
            ) : (
              <label class="value" label={value} valign={Gtk.Align.CENTER} />
            )}
          </revealer>
        ) : (
          <box />
        )}
      </box>
    </button>
  )
}
