/**
 * Eufy Mega Security camera card.
 *
 * Shows a still snapshot until tapped, then opens a full-screen live view with
 * pan/tilt, zoom, pan-step and preset controls discovered from the camera
 * device's own entities. Nothing streams until the full-screen view is open,
 * and the stream ends when it closes.
 *
 * The integration serves this file at /<domain>/frontend/camera-card.js. The
 * element name is derived from that domain, so side-by-side builds with a
 * different domain register their own card without clashing.
 */
const SCRIPT_URL = new URL(import.meta.url);
const DOMAIN = SCRIPT_URL.pathname.split("/").filter(Boolean)[0] || "eufy_event_gateway";
const TAG = `${DOMAIN.replace(/_/g, "-")}-camera-card`;
const IS_DEV = DOMAIN !== "eufy_event_gateway";
const UI_HIDE_MS = 5000;

const ROLE_KEYS = {
  left: "camera_pan_tilt_left",
  right: "camera_pan_tilt_right",
  up: "camera_pan_tilt_up",
  down: "camera_pan_tilt_down",
  zoom1: "camera_zoom_1",
  zoom3: "camera_zoom_3",
  step: "camera_pan_step",
};
const PRESET_KEY = "camera_preset";
const PRESET_DEFAULT_KEY = "camera_preset_default";

const CARD_CSS = `
  ha-card { overflow: hidden; }
  .wrap { position: relative; aspect-ratio: 16 / 9; background: #000; cursor: pointer; }
  .wrap.unavailable { cursor: default; }
  img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .play { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
    width: 56px; height: 56px; border-radius: 50%; background: rgba(0, 0, 0, 0.45); color: #fff;
    display: flex; align-items: center; justify-content: center; --mdc-icon-size: 32px; }
  .wrap.unavailable .play { display: none; }
  .name { position: absolute; left: 0; right: 0; bottom: 0; padding: 8px 12px; color: #fff;
    font-size: 14px; background: linear-gradient(transparent, rgba(0, 0, 0, 0.6)); }
`;

const OVERLAY_CSS = `
  .stage { position: fixed; inset: 0; z-index: 9999; background: #000; color: #fff;
    display: flex; align-items: center; justify-content: center; overflow: hidden;
    font-family: Roboto, system-ui, sans-serif; touch-action: manipulation;
    -webkit-user-select: none; user-select: none; }
  .video { position: relative; width: min(100vw, calc(100vh * 16 / 9)); aspect-ratio: 16 / 9; }
  @supports (height: 100dvh) { .video { width: min(100vw, calc(100dvh * 16 / 9)); } }
  .hint { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    text-align: center; padding: 16px; color: rgba(255, 255, 255, 0.7); font-size: 15px; }
  .live { position: absolute; inset: 0; width: 100%; height: 100%; display: block;
    --ha-card-border-radius: 0; --ha-card-border-width: 0; --ha-card-box-shadow: none;
    --ha-card-background: transparent; --card-background-color: transparent; }
  .frame { position: absolute; left: 33.333%; top: 33.333%; width: 33.333%; height: 33.333%;
    border: 1.5px dashed rgba(255, 255, 255, 0.55); border-radius: 2px; pointer-events: none; }
  [hidden] { display: none !important; }
  .ui { position: absolute; inset: 0; pointer-events: none; transition: opacity 0.3s; }
  .ui > * { pointer-events: auto; }
  .ui.hidden { opacity: 0; }
  .ui.hidden, .ui.hidden * { pointer-events: none !important; }
  .top { position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center; gap: 8px;
    padding: calc(env(safe-area-inset-top) + 8px) calc(env(safe-area-inset-right) + 12px) 8px calc(env(safe-area-inset-left) + 12px);
    background: linear-gradient(rgba(0, 0, 0, 0.6), transparent); }
  .title { flex: 1; font-size: 16px; text-shadow: 0 1px 2px #000; }
  button { font: inherit; color: #fff; border: none; cursor: pointer; background: rgba(0, 0, 0, 0.45);
    display: inline-flex; align-items: center; justify-content: center; gap: 6px; --mdc-icon-size: 24px;
    -webkit-tap-highlight-color: transparent; }
  button:active { background: rgba(255, 255, 255, 0.3); }
  .icon { width: 48px; height: 48px; border-radius: 50%; padding: 0; }
  .pill { height: 40px; min-width: 40px; padding: 0 14px; border-radius: 20px; font-size: 14px; }
  .side { position: absolute; display: flex; flex-direction: column; align-items: flex-start; gap: 8px;
    left: calc(env(safe-area-inset-left) + 16px); bottom: calc(env(safe-area-inset-bottom) + 16px); }
  .presets { position: absolute; left: 50%; transform: translateX(-50%); display: flex; flex-wrap: wrap;
    justify-content: center; gap: 8px; max-width: 46vw; bottom: calc(env(safe-area-inset-bottom) + 16px); }
  .dpad { position: absolute; display: grid; grid-template-columns: repeat(3, 48px);
    grid-template-rows: repeat(3, 48px); gap: 4px;
    right: calc(env(safe-area-inset-right) + 16px); bottom: calc(env(safe-area-inset-bottom) + 16px); }
  .toast { position: absolute; left: 50%; top: calc(env(safe-area-inset-top) + 64px); transform: translateX(-50%);
    max-width: 80vw; padding: 8px 14px; border-radius: 8px; font-size: 14px; background: rgba(170, 30, 30, 0.9);
    opacity: 0; transition: opacity 0.3s; pointer-events: none !important; }
  .toast.show { opacity: 1; }
`;

const OVERLAY_HTML = `
  <div class="stage">
    <div class="video">
      <div class="hint">Connecting to camera… this can take up to 15 s</div>
      <div class="frame"></div>
    </div>
    <div class="ui">
      <div class="top">
        <span class="title"></span>
        <button class="icon" data-act="close" title="Close"><ha-icon icon="mdi:close"></ha-icon></button>
      </div>
      <div class="side">
        <button class="pill" data-act="zoom" title="Zoom"><ha-icon class="zoom-icon" icon="mdi:magnify-plus-outline"></ha-icon><span class="zoom-label">1x</span></button>
        <button class="pill" data-act="step" title="Pan step"><ha-icon icon="mdi:arrow-expand-horizontal"></ha-icon><span class="step-label"></span></button>
      </div>
      <div class="presets"></div>
      <div class="dpad">
        <span></span>
        <button class="icon" data-act="pan" data-role="up" title="Tilt up"><ha-icon icon="mdi:chevron-up"></ha-icon></button>
        <span></span>
        <button class="icon" data-act="pan" data-role="left" title="Pan left"><ha-icon icon="mdi:chevron-left"></ha-icon></button>
        <span></span>
        <button class="icon" data-act="pan" data-role="right" title="Pan right"><ha-icon icon="mdi:chevron-right"></ha-icon></button>
        <span></span>
        <button class="icon" data-act="pan" data-role="down" title="Tilt down"><ha-icon icon="mdi:chevron-down"></ha-icon></button>
        <span></span>
      </div>
      <div class="toast"></div>
    </div>
  </div>
`;

/** Map the camera device's entities to card roles by their translation keys. */
function findRoles(hass, cameraEntityId) {
  const roles = { presets: [] };
  const camera = hass.entities?.[cameraEntityId];
  if (!camera?.device_id) return roles;
  for (const entry of Object.values(hass.entities)) {
    if (entry.device_id !== camera.device_id || entry.platform !== DOMAIN || entry.hidden) continue;
    const key = entry.translation_key;
    if (key === PRESET_KEY || key === PRESET_DEFAULT_KEY) {
      const match = /_(\d+)$/.exec(entry.entity_id);
      roles.presets.push({
        entityId: entry.entity_id,
        isDefault: key === PRESET_DEFAULT_KEY,
        number: match ? Number(match[1]) : -1,
      });
      continue;
    }
    for (const [role, roleKey] of Object.entries(ROLE_KEYS)) {
      if (key === roleKey) roles[role] = entry.entity_id;
    }
  }
  roles.presets.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.number - b.number);
  return roles;
}

/**
 * Play the live view through Home Assistant's own picture-entity card. Building
 * ha-camera-stream directly is fragile: it queries stream capabilities before a
 * card can hand it hass. The built-in card owns that lifecycle and ends the
 * stream when it is removed.
 */
async function createLiveCard(entityId) {
  try {
    const helpers = await window.loadCardHelpers?.();
    if (!helpers) return null;
    return helpers.createCardElement({
      type: "picture-entity",
      entity: entityId,
      camera_view: "live",
      aspect_ratio: "16:9",
      fit_mode: "contain",
      show_name: false,
      show_state: false,
      tap_action: { action: "none" },
      hold_action: { action: "none" },
      double_tap_action: { action: "none" },
    });
  } catch (_error) {
    return null;
  }
}

/**
 * Attach the overlay where Home Assistant keeps its own dialogs. Players inside
 * <home-assistant> receive the frontend context; under document.body they never
 * get a connection and request no stream.
 */
function overlayParent() {
  return document.querySelector("home-assistant")?.shadowRoot || document.body;
}

/** Full-screen live view attached next to Home Assistant's dialogs so dashboard layouts cannot clip it. */
class LiveOverlay {
  constructor(card) {
    this.card = card;
    this.entityId = card._config.entity;
    this.roles = findRoles(card._hass, this.entityId);
    this.zoom = 1;
    this.closed = false;
    this.nativeFullscreen = false;
    this.onKey = (event) => {
      if (event.key === "Escape") this.close();
    };
    this.onVisibility = () => {
      if (document.hidden) this.close();
    };
    this.onFullscreen = () => {
      if (this.nativeFullscreen && !document.fullscreenElement) this.close();
    };
  }

  open() {
    const hass = this.card._hass;
    const state = hass.states[this.entityId];
    const roles = this.roles;
    this.host = document.createElement("div");
    this.root = this.host.attachShadow({ mode: "open" });
    this.root.innerHTML = `<style>${OVERLAY_CSS}</style>${OVERLAY_HTML}`;
    this.ui = this.root.querySelector(".ui");
    this.frame = this.root.querySelector(".frame");
    this.root.querySelector(".title").textContent =
      this.card._config.title ?? state?.attributes.friendly_name ?? this.entityId;

    const hasZoom = Boolean(roles.zoom1 && roles.zoom3);
    this.root.querySelectorAll('[data-act="pan"]').forEach((button) => {
      button.hidden = !roles[button.dataset.role];
    });
    this.root.querySelector(".dpad").hidden = !(roles.left || roles.right || roles.up || roles.down);
    this.root.querySelector('[data-act="zoom"]').hidden = !hasZoom;
    this.root.querySelector('[data-act="step"]').hidden = !roles.step;
    this.frame.hidden = !hasZoom;

    const presets = this.root.querySelector(".presets");
    for (const preset of roles.presets) {
      const button = document.createElement("button");
      button.className = "pill";
      button.dataset.act = "preset";
      button.dataset.entity = preset.entityId;
      button.title = hass.states[preset.entityId]?.attributes.friendly_name ?? preset.entityId;
      if (preset.isDefault) {
        const icon = document.createElement("ha-icon");
        icon.setAttribute("icon", "mdi:home");
        button.append(icon);
      } else {
        button.textContent = String(preset.number);
      }
      presets.append(button);
    }

    this.root.addEventListener("click", (event) => this.onClick(event));
    this.root.querySelector(".stage").addEventListener("pointerdown", () => this.poke(), true);
    const parent = overlayParent();
    parent.append(this.host);
    console.info(`${TAG}: overlay attached to ${parent === document.body ? "document.body" : "home-assistant shadow root"}`);
    document.addEventListener("keydown", this.onKey);
    document.addEventListener("visibilitychange", this.onVisibility);
    document.addEventListener("fullscreenchange", this.onFullscreen);
    if (this.host.requestFullscreen) {
      this.host.requestFullscreen().then(() => {
        this.nativeFullscreen = true;
      }).catch(() => {
        // iOS and some webviews have no element full screen; the fixed overlay still covers the view.
      });
    }

    this.update(hass);
    this.poke();
    const timeout = Number(this.card._config.stream_timeout) || 0;
    if (timeout > 0) this.timeout = setTimeout(() => this.close(), timeout * 1000);
    this.startStream(hass, state);
  }

  async startStream(hass) {
    // Let Home Assistant load its lazily defined camera player.
    if (!customElements.get("ha-camera-stream")) await createLiveCard(this.entityId);
    await Promise.race([
      customElements.whenDefined("ha-camera-stream"),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    if (this.closed) return;
    if (!customElements.get("ha-camera-stream")) {
      this.root.querySelector(".hint").textContent = "Live player unavailable in this Home Assistant version.";
      return;
    }
    const stream = document.createElement("ha-camera-stream");
    stream.classList.add("live");
    this.root.querySelector(".video").insertBefore(stream, this.frame);
    // Assign properties only once the element is upgraded: values set before an
    // upgrade through Home Assistant's scoped element registry can be lost.
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
    if (this.closed) {
      stream.remove();
      return;
    }
    const current = this.card._hass || hass;
    stream.muted = true;
    stream.controls = false;
    stream.allowExoPlayer = false;
    stream.hass = current;
    // Setting stateObj last starts the capability query with hass already present.
    stream.stateObj = current.states[this.entityId];
    this.liveCard = stream;
    console.info(`${TAG}: live player upgraded=${stream.constructor !== HTMLElement} hass=${Boolean(stream.hass)}`);
  }

  onClick(event) {
    const button = event.target.closest("button[data-act]");
    if (!button) return;
    const roles = this.roles;
    switch (button.dataset.act) {
      case "close":
        this.close();
        break;
      case "pan":
        this.card._press(roles[button.dataset.role]);
        break;
      case "zoom": {
        const target = this.zoom === 1 ? 3 : 1;
        this.card._press(roles[`zoom${target}`]);
        this.zoom = target;
        this.renderZoom();
        break;
      }
      case "step":
        this.card._call("select", "select_next", { entity_id: roles.step, cycle: true });
        break;
      case "preset":
        this.card._press(button.dataset.entity);
        break;
      default:
        break;
    }
  }

  renderZoom() {
    this.root.querySelector(".zoom-label").textContent = `${this.zoom}x`;
    this.root.querySelector(".zoom-icon").setAttribute(
      "icon",
      this.zoom === 1 ? "mdi:magnify-plus-outline" : "mdi:magnify-minus-outline",
    );
    // The frame previews the 3x area, so it only makes sense at 1x.
    this.frame.hidden = this.zoom !== 1 || !(this.roles.zoom1 && this.roles.zoom3);
  }

  poke() {
    this.ui.classList.remove("hidden");
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.ui.classList.add("hidden"), UI_HIDE_MS);
  }

  toast(message) {
    if (this.closed) return;
    const toast = this.root.querySelector(".toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.remove("show"), 4000);
  }

  update(hass) {
    if (!this.closed && this.liveCard) this.liveCard.hass = hass;
    if (this.closed || !this.roles.step) return;
    const state = hass.states[this.roles.step];
    const label = state ? (hass.formatEntityState ? hass.formatEntityState(state) : state.state) : "";
    this.root.querySelector(".step-label").textContent = label;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timeout);
    clearTimeout(this.hideTimer);
    clearTimeout(this.toastTimer);
    document.removeEventListener("keydown", this.onKey);
    document.removeEventListener("visibilitychange", this.onVisibility);
    document.removeEventListener("fullscreenchange", this.onFullscreen);
    if (this.nativeFullscreen && document.fullscreenElement) document.exitFullscreen().catch(() => {});
    // Removing the player ends the stream.
    this.host.remove();
    if (this.card._overlay === this) this.card._overlay = null;
  }
}

class EufyMegaCameraCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._queue = Promise.resolve();
    this._overlay = null;
    this._bust = 0;
    this._src = null;
  }

  static getStubConfig(hass) {
    const camera = Object.values(hass.entities || {}).find(
      (entry) => entry.platform === DOMAIN && entry.entity_id.startsWith("camera."),
    );
    return { entity: camera ? camera.entity_id : "camera." };
  }

  setConfig(config) {
    if (!config || typeof config.entity !== "string" || !/^camera\.\w+$/.test(config.entity)) {
      throw new Error("Set 'entity' to a camera entity of Eufy Mega Security");
    }
    this._config = { stream_timeout: 300, snapshot_refresh: 0, ...config };
    this.shadowRoot.innerHTML = `<style>${CARD_CSS}</style>
      <ha-card>
        <div class="wrap">
          <img alt="">
          <div class="play"><ha-icon icon="mdi:play"></ha-icon></div>
          <div class="name"></div>
        </div>
      </ha-card>`;
    this.shadowRoot.querySelector(".wrap").addEventListener("click", () => this._open());
    this._src = null;
    this._startRefresh();
    this._update();
  }

  set hass(hass) {
    this._hass = hass;
    this._update();
    if (this._overlay) this._overlay.update(hass);
  }

  getCardSize() {
    return 4;
  }

  getGridOptions() {
    return { columns: 12, min_columns: 4 };
  }

  connectedCallback() {
    this._startRefresh();
  }

  disconnectedCallback() {
    clearInterval(this._timer);
    // Dashboards re-parent cards on resize (entering full screen resizes the window),
    // so only close the live view if the card does not come back.
    setTimeout(() => {
      if (!this.isConnected && this._overlay) this._overlay.close();
    }, 1000);
  }

  _startRefresh() {
    clearInterval(this._timer);
    const seconds = Number(this._config?.snapshot_refresh) || 0;
    if (seconds > 0 && this.isConnected) {
      this._timer = setInterval(() => {
        this._bust = Date.now();
        this._update();
      }, seconds * 1000);
    }
  }

  _update() {
    const wrap = this.shadowRoot.querySelector(".wrap");
    if (!this._hass || !this._config || !wrap) return;
    const state = this._hass.states[this._config.entity];
    wrap.classList.toggle("unavailable", !state || state.state === "unavailable");
    this.shadowRoot.querySelector(".name").textContent =
      this._config.title ?? state?.attributes.friendly_name ?? this._config.entity;
    const picture = state?.attributes.entity_picture;
    let src = "";
    if (picture) {
      src = this._bust ? `${picture}${picture.includes("?") ? "&" : "?"}_=${this._bust}` : picture;
    }
    if (src !== this._src) {
      this._src = src;
      const img = this.shadowRoot.querySelector("img");
      if (src) img.src = src;
      else img.removeAttribute("src");
    }
  }

  _open() {
    if (this._overlay || !this._hass) return;
    const state = this._hass.states[this._config.entity];
    if (!state || state.state === "unavailable") return;
    this._overlay = new LiveOverlay(this);
    this._overlay.open();
  }

  /** Serialize presses so quick taps reach the gateway in order. */
  _press(entityId) {
    if (entityId) this._call("button", "press", { entity_id: entityId });
  }

  _call(domain, service, data) {
    this._queue = this._queue
      .then(() => this._hass.callService(domain, service, data))
      .catch((error) => this._overlay?.toast(error?.message || String(error)));
  }
}

if (!customElements.get(TAG)) customElements.define(TAG, EufyMegaCameraCard);
window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === TAG)) {
  window.customCards.push({
    type: TAG,
    name: IS_DEV ? "Eufy Mega camera (Dev)" : "Eufy Mega camera",
    description: "Snapshot until tapped, then a full-screen live view with pan/tilt, zoom and presets.",
    preview: false,
    documentationURL: "https://github.com/mscodemonkey/eufy-mega-security",
  });
}
console.info(`%c${TAG}%c ${SCRIPT_URL.searchParams.get("v") || ""}`, "font-weight:bold", "");
