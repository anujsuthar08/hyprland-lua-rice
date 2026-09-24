import { createBinding, createComputed, With } from "ags"
import AstalMpris from "gi://AstalMpris?version=0.1"

const MAX = 34

export default function Media() {
  const mpris = AstalMpris.get_default()
  const players = createBinding(mpris, "players")

  return (
    <box class="Media chip">
      <With value={createComputed([players], (p) => p[0] ?? null)}>
        {(player) => {
          if (!player) return <box />

          const title = createBinding(player, "title")
          const artist = createBinding(player, "artist")
          const status = createBinding(player, "playbackStatus")

          const icon = createComputed([status], (s) =>
            s === AstalMpris.PlaybackStatus.PLAYING ? "󰏤" : "󰐊",
          )
          const text = createComputed([title, artist], (t, a) => {
            const s = a ? `${a} — ${t}` : (t ?? "")
            return s.length > MAX ? s.slice(0, MAX - 1) + "…" : s
          })

          return (
            <button onClicked={() => player.play_pause()}>
              <box>
                <label class="icon" label={icon} />
                <label class="title" label={text} />
              </box>
            </button>
          )
        }}
      </With>
    </box>
  )
}
