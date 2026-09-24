import { createComputed } from "ags"
import { Gtk } from "ags/gtk4"
import { hoverEnter, hoverLeave, toggleDropdown } from "./dropdown"
import { VPN } from "./icons"
import { stats } from "./BandwidthMenu"

// A shield glyph that exists ONLY while the default route is going
// through a VPN — same idiom as Mic.tsx's mute glyph: the useful fact
// is the deviation from normal, not the steady state, so there is
// nothing to look at the rest of the time.
//
// `stats` (from BandwidthMenu.tsx) already tells us this every 3s —
// scripts/bandwidth-loop.c classifies whichever interface currently
// holds the default route by whether it has a real hardware device
// behind it, not by guessing name prefixes, so it's right for
// WireGuard, OpenVPN, Tailscale, a corporate client, whatever ends up
// installed here. Reading the same accessor rather than spawning a
// second subprocess — see BandwidthMenu.tsx's own comment on why only
// one reader of that binary's output can exist at a time.
//
// Toggling GTK's `visible` on an always-mounted button, NOT wrapping
// the button in <With> (Mic.tsx's mute glyph does that, and has the
// same latent bug — see 04-build-state.md's 2026-09-06 VPN entry): a
// <With> that swaps its rendered child after first mount re-fires
// Fragment's "append" signal, which gnim's GTK4 bridge turns into a
// plain `parent.append(child)` — real GTK, no positional insert — so
// the widget lands at the END of the cluster box instead of back in
// its JSX slot. Confirmed by reproducing it here: the shield rendered
// after SessionMenu/Battery/SysTray on the first VPN-connect,
// regardless of where in Bar.tsx's cluster it was declared. A button
// that's always present, hidden via `visible`, never leaves the box's
// child list in the first place, so this can't happen — and an
// invisible GTK widget claims no layout space, so it looks identical
// to not being mounted at all.
export default function VpnIndicator() {
  const isVpn = createComputed([stats], (s) => s[6] === 1)

  return (
    <button
      class="glyph vpn-active"
      visible={isVpn}
      tooltipText="VPN connected — click for details"
      onClicked={(self: Gtk.Button) => toggleDropdown("bandwidth", self)}
      $={(self: Gtk.Button) => {
        const motion = new Gtk.EventControllerMotion()
        motion.connect("enter", () => hoverEnter("bandwidth", self))
        motion.connect("leave", () => hoverLeave())
        self.add_controller(motion)
      }}
    >
      <image class="icon" iconName={VPN} pixelSize={18} valign={Gtk.Align.CENTER} />
    </button>
  )
}
