import { createBinding, createComputed, With } from "ags"
import { Gtk } from "ags/gtk4"
import AstalCava from "gi://AstalCava?version=0.1"
import AstalMpris from "gi://AstalMpris?version=0.1"

//
// Small live spectrum riding next to Media.tsx. Only shown while
// something is actually playing — a visualizer twitching over silence
// is just noise next to the track title.
//
// AstalCava wraps cava directly (values 0..1 per bar, reactive via the
// normal notify:: signal machinery) — no raw-stdout parsing needed.
//
const BARS = 7
const MAX_BAR_HEIGHT = 14

export default function Cava() {
  const cava = AstalCava.get_default()
  if (!cava) return <box />

  // NOTE: `stereo` does NOT control the values array's length — that's
  // `channels`. With channels left at its default (2), `values` comes
  // back as bars*2, mirrored between the two halves, regardless of
  // what `stereo` is set to. Verified against real audio: bars=7 +
  // stereo=false still produced a 14-length mirrored array; bars=7 +
  // channels=1 produced the expected 7-length array.
  cava.bars = BARS
  cava.channels = 1

  const values = createBinding(cava, "values")

  const mpris = AstalMpris.get_default()
  const players = createBinding(mpris, "players")
  const playing = createComputed(
    [players],
    (p) => p[0]?.playbackStatus === AstalMpris.PlaybackStatus.PLAYING,
  )

  return (
    <With value={playing}>
      {(isPlaying) =>
        isPlaying ? (
          <box class="Cava chip flat" spacing={2}>
            {Array.from({ length: BARS }, (_, i) => (
              <box
                class="cava-bar"
                valign={Gtk.Align.END}
                heightRequest={createComputed([values], (v) =>
                  Math.max(2, Math.round((v[i] ?? 0) * MAX_BAR_HEIGHT)),
                )}
              />
            ))}
          </box>
        ) : (
          <box />
        )
      }
    </With>
  )
}
