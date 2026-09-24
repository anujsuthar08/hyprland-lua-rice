import { createComputed, createState } from "ags"
import { Gtk } from "ags/gtk4"
import { execAsync } from "ags/process"
import Menu from "./Menu"
import { caffeine, toggleCaffeine } from "./caffeineState"
import { closeDropdown } from "./dropdown"
import { CAFFEINE, CAFFEINE_OFF, LOCK, LOGOUT, POWEROFF, REBOOT, SESSION, SLEEP } from "./icons"

// Power actions and the keep-awake toggle.
//
// Lock and suspend were keybinds only (conf/binds.lua), which is fine
// until you are holding a laptop with one hand. Reboot and shut down
// had no route out of the shell at all short of a terminal.

const sh = (cmd: string) => execAsync(["bash", "-c", cmd])

// "Keep awake" is the shared Caffeine mechanism (caffeineState.ts): a systemd idle inhibitor
// that hypridle honours. It used to `pkill hypridle` and restart it by hand, which left the
// idle daemon outside its supervised unit and could leave the screen never locking after a
// crash or a forgotten toggle. Same switch as the Control Center tile and SUPER+F3.
const inhibited = caffeine


// How long "Sure?" stays armed. Without this it lingered indefinitely:
// arm Log out, close the panel, come back an hour later, and a single
// click logs you out.
const ARM_MS = 3000

export function SessionPanel() {
  // Two-step on anything that ends the session. A mis-click on the bar
  // should never be able to power the machine off, and a confirm step
  // costs one extra click on an action taken twice a day.
  const [armed, setArmed] = createState<string | null>(null)

  let disarm: ReturnType<typeof setTimeout> | undefined

  function act(id: string, cmd: string, confirm: boolean) {
    clearTimeout(disarm)
    if (confirm && armed.peek() !== id) {
      setArmed(id)
      disarm = setTimeout(() => setArmed(null), ARM_MS)
      return
    }
    setArmed(null)
    closeDropdown()
    sh(cmd).catch((e) => console.error("session action failed", id, e))
  }

  function Action(props: {
    id: string
    icon: string
    label: string
    cmd: string
    confirm?: boolean
    danger?: boolean
  }) {
    const { id, icon, label, cmd, confirm = false, danger = false } = props

    return (
      <button
        class={createComputed([armed], (a) =>
          ["action", danger && "danger", a === id && "armed"]
            .filter(Boolean)
            .join(" "),
        )}
        tooltipText={label}
        onClicked={() => act(id, cmd, confirm)}
      >
        <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
          <image class="icon" iconName={icon} pixelSize={18} halign={Gtk.Align.CENTER} />
          <label
            class="caption"
            label={createComputed([armed], (a) => (a === id ? "Sure?" : label))}
          />
        </box>
      </button>
    )
  }

  return (
    <box class="Panel SessionPanel" orientation={Gtk.Orientation.VERTICAL} spacing={10}>
      <box class="panel-head">
        <label class="panel-title" label="Session" xalign={0} hexpand />
      </box>

      <box class="actions" spacing={4} homogeneous>
        <Action id="lock" icon={LOCK} label="Lock" cmd="hyprlock" />
        <Action id="suspend" icon={SLEEP} label="Sleep" cmd="pidof hyprlock || hyprlock & sleep 0.4; systemctl suspend" />
        <Action
          id="logout"
          icon={LOGOUT}
          label="Log out"
          cmd={`hyprctl dispatch "hl.dsp.exit()"`}
          confirm
        />
        <Action id="reboot" icon={REBOOT} label="Restart" cmd="systemctl reboot" confirm />
        <Action
          id="off"
          icon={SESSION}
          label="Shut down"
          cmd="systemctl poweroff"
          confirm
          danger
        />
      </box>

      <button
        class={createComputed([inhibited], (on) => `row toggle ${on ? "active" : ""}`)}
        onClicked={() => toggleCaffeine()}
      >
        <box spacing={8}>
          <image
            class="icon"
            iconName={createComputed([inhibited], (on) => (on ? CAFFEINE : CAFFEINE_OFF))}
            pixelSize={16}
          />
          <label xalign={0} hexpand label="Keep awake" />
          <label
            class="value"
            label={createComputed([inhibited], (on) => (on ? "on" : "off"))}
          />
        </box>
      </button>
    </box>
  )
}

export default function SessionMenu() {
  return (
    <Menu
      name="session"
      icon={SESSION}
      // Keep-awake is a mode you can forget you left on, so it shows on
      // the bar itself rather than only inside the panel.
      extra={createComputed([inhibited], (on) => (on ? "awake" : ""))}
      tooltip="Session"
    />
  )
}
