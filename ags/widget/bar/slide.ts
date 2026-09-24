import type { Gtk } from "ags/gtk4"

// Handler for a slider's `onChangeValue`.
//
// GTK emits `change-value` TWICE per user change, and on the first
// emission the widget's own `.value` is still the OLD value. The natural
// `({ value }) => ...` destructures the widget, so it wrote the stale value
// first and the new one ~20ms later — for anything backed by a process
// (brightnessctl) the two writes race and can land in either order, so a
// click could "do nothing" or the level could blip. The third argument is
// always the new value, and the duplicate emission is dropped.
export function onSlide(apply: (value: number) => void) {
  let lastValue = NaN
  let lastAt = 0

  return (_self: Gtk.Range, _scroll: number, value: number) => {
    const now = Date.now()
    if (value === lastValue && now - lastAt < 150) return
    lastValue = value
    lastAt = now
    apply(value)
  }
}
