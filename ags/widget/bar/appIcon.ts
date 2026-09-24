import { Gdk, Gtk } from "ags/gtk4"
import AstalApps from "gi://AstalApps?version=0.1"

// Shared with WorkspacePreview.tsx — both need "which icon for this
// window class", and the lookup is expensive enough (icon theme probe,
// then a fuzzy search across every desktop entry) that it's worth one
// cache for the whole shell rather than one per widget.
const apps = new AstalApps.Apps()

const iconCache = new Map<string, string>()
const FALLBACK = "application-x-executable"

export function iconFor(cls: string): string {
  if (!cls) return FALLBACK

  const cached = iconCache.get(cls)
  if (cached) return cached

  const display = Gdk.Display.get_default()
  const theme = display ? Gtk.IconTheme.get_for_display(display) : null

  // Hyprland reports classes in several shapes — "kitty", "Code",
  // "org.kde.dolphin", "firefox". Try the literal first, then the
  // lower-cased form, then the last segment of a reverse-DNS id.
  const tail = cls.includes(".") ? cls.split(".").pop()! : ""
  const direct = [cls, cls.toLowerCase(), tail, tail.toLowerCase()].filter(Boolean)

  for (const name of direct) {
    if (theme?.has_icon(name)) {
      iconCache.set(cls, name)
      return name
    }
  }

  // Nothing in the icon theme answers to the class, so ask the desktop
  // entries — this is what catches apps whose window class and icon
  // name disagree (Chromium's PWAs, Electron apps, anything launched
  // through a wrapper).
  const hit = apps.fuzzy_query(cls)[0]
  const name = hit?.iconName && theme?.has_icon(hit.iconName) ? hit.iconName : FALLBACK

  iconCache.set(cls, name)
  return name
}
