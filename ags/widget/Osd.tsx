import app from "ags/gtk4/app"
import { Astal, Gdk, Gtk } from "ags/gtk4"
import { createBinding, createState, onCleanup } from "ags"
import AstalWp from "gi://AstalWp?version=0.1"
import { volumeIcon } from "./bar/icons"

const VISIBLE_MS = 1500

//
// On-screen display for volume / brightness. The media keys are bound
// in conf/binds.lua and previously gave no feedback at all.
//
export default function Osd(gdkmonitor: Gdk.Monitor) {
  const { BOTTOM } = Astal.WindowAnchor
  const speaker = AstalWp.get_default()!.audio.defaultSpeaker

  const [visible, setVisible] = createState(false)
  const [icon, setIcon] = createState(volumeIcon(0.5, false))
  const [value, setValue] = createState(0)

  let timer: ReturnType<typeof setTimeout> | null = null

  const show = (ico: string, val: number) => {
    setIcon(ico)
    setValue(val)
    setVisible(true)
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => setVisible(false), VISIBLE_MS)
  }

  // skip the initial property emission so the OSD doesn't flash on start
  let primed = false

  const volId = speaker.connect("notify::volume", () => {
    if (!primed) return
    show(volumeIcon(speaker.volume, speaker.mute), speaker.volume)
  })
  const muteId = speaker.connect("notify::mute", () => {
    if (!primed) return
    show(volumeIcon(speaker.volume, speaker.mute), speaker.volume)
  })
  setTimeout(() => { primed = true }, 1000)

  onCleanup(() => {
    speaker.disconnect(volId)
    speaker.disconnect(muteId)
    if (timer) clearTimeout(timer)
  })

  return (
    <window
      visible={visible}
      name="osd"
      namespace="osd"
      class="Osd hypr-shell"
      gdkmonitor={gdkmonitor}
      exclusivity={Astal.Exclusivity.IGNORE}
      anchor={BOTTOM}
      application={app}
      marginBottom={120}
    >
      <box class="Osd" orientation={Gtk.Orientation.VERTICAL}>
        <image iconName={icon} pixelSize={28} halign={Gtk.Align.CENTER} />
        <levelbar value={value} minValue={0} maxValue={1} />
      </box>
    </window>
  )
}
