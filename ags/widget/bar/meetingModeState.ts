import { createState } from "ags"
import AstalWp from "gi://AstalWp?version=0.1"
import AstalNotifd from "gi://AstalNotifd?version=0.1"

// Meeting mode: one action, two existing pieces — mute the mic
// (Mic.tsx already shows a glyph for that) and turn on Do Not Disturb
// (NotificationMenu.tsx already has a chip for that). No new
// infrastructure, just a combo action, SUPER+F4 next to Caffeine.
//
// Saves whatever mic/DND were set to BEFORE entering, and restores
// those exact values on the way out — not a blind "force both off" —
// so leaving a meeting doesn't unmute a mic you had muted for an
// unrelated reason, or turn off DND you'd already turned on yourself.
// This is deliberately its own tracked boolean rather than a
// computed `mic.mute && notifd.dontDisturb`: either of those can
// still be flipped independently through their own existing controls
// while "in a meeting" — this only remembers what ITS OWN toggle did.

const [inMeeting, setInMeeting] = createState(false)
export const meetingMode = inMeeting

let priorMicMute: boolean | null = null
let priorDnd = false

export function toggleMeetingMode() {
  const mic = AstalWp.get_default()?.audio?.defaultMicrophone
  const notifd = AstalNotifd.get_default()

  if (!inMeeting.peek()) {
    priorMicMute = mic?.mute ?? null
    priorDnd = notifd.dontDisturb
    if (mic) mic.mute = true
    notifd.dontDisturb = true
    setInMeeting(true)
  } else {
    if (mic && priorMicMute !== null) mic.mute = priorMicMute
    notifd.dontDisturb = priorDnd
    priorMicMute = null
    priorDnd = false
    setInMeeting(false)
  }
}
