import app from "ags/gtk4/app"
import { Astal, Gdk, Gtk } from "ags/gtk4"
import { createBinding, createComputed, createState } from "ags"
import { execAsync } from "ags/process"
import { interval } from "ags/time"

import AstalWp from "gi://AstalWp?version=0.1"
import AstalNetwork from "gi://AstalNetwork?version=0.1"
import AstalBluetooth from "gi://AstalBluetooth?version=0.1"
import AstalPowerProfiles from "gi://AstalPowerProfiles?version=0.1"

import { elapsed, fmtElapsed, recording, stopRecording, toggleRecording } from "./bar/recordState"
import { onSlide } from "./bar/slide"
import AppMixer from "./bar/AppMixer"
import { cycleSlideshow, slideshowOn, slideshowStatus } from "./bar/slideshowState"
import {
  airplaneOn, hasVpn, hotspotAvailable, hotspotOn, toggleAirplane, toggleHotspot, toggleVpn, vpnOn, vpnStatus,
} from "./bar/netToggleState"
import { caffeine, toggleCaffeine } from "./bar/caffeineState"
import { cycleNightLight, mode as nightMode, nightStatus } from "./bar/nightState"
import AstalNotifd from "gi://AstalNotifd?version=0.1"
import { notificationIcon } from "./bar/icons"
import { MIC, MIC_MUTED, bluetoothIcon, brightnessIcon, volumeIcon, wifiIcon, WIFI_OFF } from "./bar/icons"

// A pill with a status line under the name, so the tile answers "what is
// it connected to" without opening the network panel.
function Tile(props: {
  icon: any
  label: string
  status: any
  active: any
  onClicked: () => void
  visible?: any
}) {
  return (
    <button
      class={createComputed([props.active], (a) => `tile ${a ? "active" : ""}`)}
      onClicked={props.onClicked}
      hexpand
      visible={props.visible ?? true}
    >
      <box spacing={9}>
        <image class="tile-icon" iconName={props.icon} pixelSize={16} valign={Gtk.Align.CENTER} />
        <box orientation={Gtk.Orientation.VERTICAL} valign={Gtk.Align.CENTER}>
          <label class="tile-title" label={props.label} xalign={0} />
          <label class="tile-status" label={props.status} xalign={0} />
        </box>
      </box>
    </button>
  )
}

// icon (optionally a mute button) · slider · value
function SliderRow(props: {
  icon: any
  value: any
  percent: any
  onChange: (v: number) => void
  onIcon?: () => void
  muted?: any
  min?: number
  max?: number
  tooltip: string
}) {
  return (
    <box class="slider-row" spacing={8}>
      {props.onIcon ? (
        <button
          class={createComputed([props.muted], (m) => `icon-btn ${m ? "muted" : ""}`)}
          tooltipText={props.tooltip}
          onClicked={props.onIcon}
        >
          <image iconName={props.icon} pixelSize={16} />
        </button>
      ) : (
        <image class="glyph-static" iconName={props.icon} pixelSize={16} />
      )}
      <slider
        hexpand
        min={props.min ?? 0}
        max={props.max ?? 1}
        value={props.value}
        onChangeValue={onSlide(props.onChange)}
      />
      <label class="value" xalign={1} label={props.percent} />
    </box>
  )
}

export default function ControlCenter() {
  const { TOP, RIGHT, BOTTOM, LEFT } = Astal.WindowAnchor

  const audio = AstalWp.get_default()!.audio

  const net = AstalNetwork.get_default()
  const bt = AstalBluetooth.get_default()
  const power = AstalPowerProfiles.get_default()

  // The default speaker / mic change when headphones or a webcam mic are
  // plugged in, and there may be no mic at all. Bind through the
  // property path (it re-subscribes on both hops and tolerates null)
  // and look the device up again at click time, instead of capturing
  // whichever one existed at startup.
  const spkVolume = createBinding(audio, "defaultSpeaker", "volume")
  const spkMute = createBinding(audio, "defaultSpeaker", "mute")
  const micVolume = createBinding(audio, "defaultMicrophone", "volume")
  const micMute = createBinding(audio, "defaultMicrophone", "mute")

  // Wi-Fi radio state. createBinding(net, "wifi") only fires when the
  // wifi OBJECT is replaced, so the toggle never lit or dimmed after an
  // outside change; the nested path follows the radio itself.
  const wifiEnabled = createBinding(net, "wifi", "enabled")
  const btPowered = createBinding(bt, "isPowered")
  const btConnected = createBinding(bt, "isConnected")
  const wifiSsid = createBinding(net, "wifi", "ssid")
  const wifiStrength = createBinding(net, "wifi", "strength")
  const activeProfile = createBinding(power, "activeProfile")
  const notifd = AstalNotifd.get_default()
  const dnd = createBinding(notifd, "dontDisturb")

  function setWifi(on: boolean) {
    execAsync(["nmcli", "radio", "wifi", on ? "on" : "off"]).catch(() => {})
  }
  function setBluetooth(on: boolean) {
    const run = on
      ? execAsync(["rfkill", "unblock", "bluetooth"]).catch(() => {}).then(() =>
          execAsync(["timeout", "8", "bluetoothctl", "power", "on"]))
      : execAsync(["timeout", "8", "bluetoothctl", "power", "off"])
    run.catch(() => {})
  }

  // There is no Astal module for backlight, so seed the slider from
  // brightnessctl once. `-m` is the machine-readable form:
  //   amdgpu_bl1,backlight,120,47%,255   -> field 4 is the percentage.
  // Without this the slider has no `value` and always renders at 0.
  const [brightness, setBrightness] = createState(0)
  let lastDrag = 0
  function readBrightness() {
    // Don't fight the user's own drag with a stale reading.
    if (Date.now() - lastDrag < 1500) return
    execAsync("sh -c \"brightnessctl -m | cut -d, -f4 | tr -d '%'\"")
      .then((out) => {
        const n = Number(String(out).trim())
        if (Number.isFinite(n)) setBrightness(n)
      })
      .catch(() => {})
  }
  readBrightness()

  function startRec(mode: "area" | "screen") {
    app.get_window("control-center")!.visible = false
    toggleRecording(mode, 350)
  }

  return (
    <window
      name="control-center"
      namespace="control-center"
      class="ControlCenter hypr-shell"
      // starts hidden; SUPER+SHIFT+N toggles it via `ags toggle`
      visible={false}
      exclusivity={Astal.Exclusivity.NORMAL}
      keymode={Astal.Keymode.ON_DEMAND}
      // Full-screen so a scrim can catch clicks outside the card. It still
      // starts below the bar (NORMAL exclusivity honours its zone).
      anchor={TOP | BOTTOM | LEFT | RIGHT}
      application={app}
      $={(self: Gtk.Window) => {
        // Brightness keys change it behind our back; re-read on open and
        // while the panel is up, and stay idle while it is hidden.
        self.connect("notify::visible", () => {
          if (!self.visible) return
          readBrightness()
          // GTK reopened the panel with focus still on whichever control had
          // it (or a default), so the first Tab landed on "Balanced". Start
          // with nothing focused: the first Tab then reaches the first
          // control (Wi-Fi), reading order from there.
          self.set_focus(null)
        })
        const keys = new Gtk.EventControllerKey()
        keys.connect("key-pressed", (_c, keyval) => {
          if (keyval !== Gdk.KEY_Escape) return false
          self.visible = false
          return true
        })
        self.add_controller(keys)
        interval(2000, () => self.visible && readBrightness())
      }}
    >
      <overlay
        $={(self: Gtk.Overlay) => {
          // Scrim is the MAIN child and the card an overlay child, so a
          // click on the card never reaches the scrim (same layout as
          // BarDropdown.tsx). One gesture on the window root would also
          // fire for every button press inside the card.
          const scrim = new Gtk.Box()
          const click = new Gtk.GestureClick()
          click.connect("pressed", () => {
            const win = self.get_root() as Gtk.Window | null
            if (win) win.visible = false
          })
          scrim.add_controller(click)
          self.set_child(scrim)
        }}
      >
      <box
        $type="overlay"
        halign={Gtk.Align.END}
        valign={Gtk.Align.START}
        // Same glass as every bar dropdown (.Dropdown), minus the slide-in.
        class="Dropdown shown Panel ControlCenter"
        orientation={Gtk.Orientation.VERTICAL}
        spacing={10}
      >
        <label class="panel-title" label="Quick settings" xalign={0} />

        <box spacing={6} homogeneous>
          <Tile
            icon={createComputed([wifiEnabled, wifiStrength], (on, st) => (on ? wifiIcon(st) : WIFI_OFF))}
            label="Wi-Fi"
            status={createComputed([wifiEnabled, wifiSsid], (on, ssid) =>
              !on ? "Off" : ssid || "Not connected",
            )}
            active={wifiEnabled}
            onClicked={() => setWifi(!wifiEnabled.peek())}
          />
          <Tile
            icon={createComputed([btPowered, btConnected], bluetoothIcon)}
            label="Bluetooth"
            status={createComputed([btPowered, btConnected], (on, c) =>
              !on ? "Off" : c ? "Connected" : "On",
            )}
            active={btPowered}
            onClicked={() => setBluetooth(!btPowered.peek())}
          />
        </box>

        <box spacing={6} homogeneous>
          <Tile
            icon="bar-moon"
            label="Night light"
            status={nightStatus}
            active={createComputed([nightMode], (m) => m !== "off")}
            onClicked={() => cycleNightLight()}
          />
          <Tile
            icon={createComputed([dnd], notificationIcon)}
            label="Do not disturb"
            status={createComputed([dnd], (d) => (d ? "On" : "Off"))}
            active={dnd}
            onClicked={() => { notifd.dontDisturb = !notifd.dontDisturb }}
          />
        </box>

        <box spacing={6} homogeneous>
          <Tile
            icon="bar-coffee"
            label="Caffeine"
            status={createComputed([caffeine], (c) => (c ? "Screen stays on" : "Off"))}
            active={caffeine}
            onClicked={() => toggleCaffeine()}
          />
          <Tile
            icon="bar-plane"
            label="Airplane mode"
            status={createComputed([airplaneOn], (a) => (a ? "On" : "Off"))}
            active={airplaneOn}
            onClicked={() => toggleAirplane()}
          />
        </box>

        {/* slideshow always; VPN needs a profile, and a hotspot on a machine with just one
            Wi-Fi adapter would cut you off, so those two show only when they can work */}
        <box spacing={6} homogeneous>
          <Tile
            icon="bar-image"
            label="Slideshow"
            status={slideshowStatus}
            active={slideshowOn}
            onClicked={() => cycleSlideshow()}
          />
          <box visible={createComputed([hasVpn, hotspotAvailable], (v, h) => !v && !h)} />
          <Tile
            icon="bar-vpn"
            label="VPN"
            status={vpnStatus}
            active={vpnOn}
            visible={hasVpn}
            onClicked={() => toggleVpn()}
          />
          <Tile
            icon="bar-hotspot"
            label="Hotspot"
            status={createComputed([hotspotOn], (h) => (h ? "Sharing" : "Off"))}
            active={hotspotOn}
            visible={hotspotAvailable}
            onClicked={() => toggleHotspot()}
          />
        </box>

        <box orientation={Gtk.Orientation.VERTICAL} spacing={2}>
          <SliderRow
            tooltip="Mute"
            icon={createComputed([spkVolume, spkMute], (v, m) => volumeIcon(v, m))}
            muted={spkMute}
            value={spkVolume}
            percent={createComputed([spkVolume], (v) => `${Math.round(v * 100)}%`)}
            onIcon={() => {
              const sp = audio.defaultSpeaker
              if (sp) sp.mute = !sp.mute
            }}
            onChange={(v) => {
              const sp = audio.defaultSpeaker
              if (sp) sp.volume = v
            }}
          />
          <SliderRow
            tooltip="Mute microphone"
            icon={createComputed([micMute], (m) => (m ? MIC_MUTED : MIC))}
            muted={micMute}
            value={micVolume}
            percent={createComputed([micVolume], (v) => `${Math.round(v * 100)}%`)}
            onIcon={() => {
              const mic = audio.defaultMicrophone
              if (mic) mic.mute = !mic.mute
            }}
            onChange={(v) => {
              const mic = audio.defaultMicrophone
              if (mic) mic.volume = v
            }}
          />
          {/* brightness — brightnessctl, no astal module for this */}
          <SliderRow
            tooltip="Brightness"
            icon={createComputed([brightness], (b) => brightnessIcon(b / 100))}
            min={0}
            max={100}
            value={brightness}
            percent={createComputed([brightness], (b) => `${Math.round(b)}%`)}
            onChange={(v) => {
              // 0% turns the panel fully off on most laptops.
              const pct = Math.max(1, Math.round(v))
              lastDrag = Date.now()
              setBrightness(pct)
              execAsync(`brightnessctl set ${pct}%`).catch(() => {})
            }}
          />
        </box>

        {/* per-app volume: only present while something is playing */}
        <AppMixer />

                {/* power profile — hidden when power-profiles-daemon isn't running,
            since the buttons would silently do nothing */}
        <box
          class="profiles"
          spacing={4}
          homogeneous
          visible={createComputed([activeProfile], (p) => !!p)}
        >
          {[
            ["power-saver", "Saver"],
            ["balanced", "Balanced"],
            ["performance", "Performance"],
          ].map(([id, label]) => (
            <button
              class={createComputed([activeProfile], (a) => `seg ${a === id ? "active" : ""}`)}
              onClicked={() => { power.activeProfile = id }}
            >
              <label label={label} />
            </button>
          ))}
        </box>

        {/* screen recording — the panel closes first so it is not the first
            frame of the capture; while recording, one Stop button */}
        <box class="recrow" spacing={4} homogeneous visible={createComputed([recording], (r) => !r)}>
          <button class="seg" onClicked={() => startRec("screen")}>
            <label label="Record screen" />
          </button>
          <button class="seg" onClicked={() => startRec("area")}>
            <label label="Record area" />
          </button>
        </box>
        <button class="recrow stop" visible={recording} onClicked={() => stopRecording()}>
          <label label={createComputed([elapsed], (e) => `Stop recording · ${e < 0 ? "" : fmtElapsed(e)}`)} />
        </button>
      </box>
      </overlay>
    </window>
  )
}
