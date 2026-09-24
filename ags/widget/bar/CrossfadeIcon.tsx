import { Accessor } from "ags"
import { Gtk } from "ags/gtk4"

// A symbolic icon that CROSSFADES when its name changes, instead of
// snapping — wifi stepping a signal bar, volume stepping a level,
// battery ticking a percent. GTK can't animate an icon-name swap via
// CSS (there is no such property), so this fakes it the way
// BarDropdown.tsx already does for whole panels: a Gtk.Stack, one
// named child per icon seen so far, CROSSFADE transition between
// named children. New names are added lazily — the set of icons a
// glyph can show is small (five volume levels, ten battery steps...)
// but never enumerated up front, so this works for any icon function
// without hardcoding its range.
export default function CrossfadeIcon(props: {
  iconName: Accessor<string> | string
  pixelSize?: number
  valign?: Gtk.Align
}) {
  const { iconName, pixelSize = 16, valign = Gtk.Align.CENTER } = props

  return (
    <stack
      transitionType={Gtk.StackTransitionType.CROSSFADE}
      // Quick — this is a glance-level status readout, not a page
      // change. Long enough to read as a fade, short enough that
      // stepping through several volume levels fast doesn't blur.
      transitionDuration={150}
      hhomogeneous={false}
      vhomogeneous={false}
      valign={valign}
      $={(self: Gtk.Stack) => {
        const known = new Set<string>()

        const show = (name: string) => {
          if (!known.has(name)) {
            known.add(name)
            const img = new Gtk.Image({ iconName: name, pixelSize })
            img.add_css_class("icon")
            self.add_named(img, name)
          }
          self.set_visible_child_name(name)
        }

        if (typeof iconName === "string") {
          show(iconName)
        } else {
          show(iconName.get())
          iconName.subscribe(() => show(iconName.get()))
        }
      }}
    />
  )
}
