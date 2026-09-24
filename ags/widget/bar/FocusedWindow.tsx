import { createBinding, createComputed } from "ags"
import AstalHyprland from "gi://AstalHyprland?version=0.1"

const MAX = 30

export default function FocusedWindow() {
  const hypr = AstalHyprland.get_default()

  // Bind through the property path rather than reading .title once:
  // focusedClient can be null, and the title keeps changing while the
  // window stays focused. createBinding's nested overload re-subscribes
  // on both hops and yields null instead of throwing when there is no
  // focused client.
  const title = createBinding(hypr, "focusedClient", "title")

  const text = createComputed([title], (t) => {
    if (!t) return ""
    return t.length > MAX ? t.slice(0, MAX - 1) + "…" : t
  })

  // Truncation is done in JS above, so the label needs no ellipsize /
  // maxWidthChars — setting those made GTK request a huge natural width
  // and then collapse the whole label to a single "…" when the bar was
  // narrow.
  return (
    <box class="FocusedWindow">
      <label label={text} />
    </box>
  )
}
