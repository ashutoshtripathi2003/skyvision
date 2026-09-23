// On-screen controls for phones and tablets. Shown automatically when the
// primary pointer is a finger (or with ?touch=1 in the URL for testing).
//   flight: virtual joystick (pitch/roll), throttle slider, AP / GEAR / FLAPS /
//           BRAKE / CAM / DAY-NIGHT / PAUSE buttons
//   demo:   START / CAMERA / DAY-NIGHT / RESET / MENU buttons
// Pointer events are used so the same code also works with a mouse.
export const IS_TOUCH = matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch');

const $ = (id) => document.getElementById(id);
const DEADZONE = 0.08;

export class TouchControls {
  constructor(actions) {
    this.enabled = IS_TOUCH;
    this.actions = actions;
    this.stick = { x: 0, y: 0 };
    this.throttleTarget = null; // set only while a finger is on the throttle
    this.brake = false;
    if (!this.enabled) return;

    document.body.classList.add('touch');
    this.root = $('touch-controls');
    this.setupStick();
    this.setupThrottle();
    this.root.querySelectorAll('[data-action]').forEach((button) => {
      const action = button.dataset.action;
      if (action === 'brake') {
        const release = () => { this.brake = false; button.classList.remove('active'); };
        button.addEventListener('pointerdown', (e) => { e.preventDefault(); this.brake = true; button.classList.add('active'); });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => button.addEventListener(type, release));
      } else {
        button.addEventListener('pointerdown', (e) => { e.preventDefault(); this.actions[action]?.(); });
      }
    });
  }

  setMode(mode) {
    if (!this.enabled) return;
    this.root.dataset.mode = mode; // 'flight' | 'demo' | 'none'
    if (mode !== 'flight') this.reset();
  }

  reset() {
    this.stick = { x: 0, y: 0 };
    this.throttleTarget = null;
    this.brake = false;
    if (this.knob) this.knob.style.transform = 'translate(-50%, -50%)';
  }

  // Values for PlayerFlight: stick down = nose up (pull back), like a real control column.
  get controls() {
    const dz = (v) => (Math.abs(v) < DEADZONE ? 0 : v);
    return { pitch: dz(this.stick.y), roll: dz(this.stick.x), throttleTarget: this.throttleTarget, brake: this.brake };
  }

  setupStick() {
    const base = $('tc-stick');
    this.knob = $('tc-knob');
    let pointer = null;
    const move = (e) => {
      const rect = base.getBoundingClientRect();
      const r = rect.width / 2;
      let dx = e.clientX - (rect.left + r);
      let dy = e.clientY - (rect.top + r);
      const len = Math.hypot(dx, dy);
      if (len > r) { dx *= r / len; dy *= r / len; } // keep the knob inside the ring
      this.stick = { x: dx / r, y: dy / r };
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    };
    base.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pointer = e.pointerId;
      base.setPointerCapture(pointer);
      move(e);
    });
    base.addEventListener('pointermove', (e) => { if (e.pointerId === pointer) move(e); });
    const end = (e) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      this.stick = { x: 0, y: 0 };
      this.knob.style.transform = 'translate(-50%, -50%)'; // spring back to centre
    };
    base.addEventListener('pointerup', end);
    base.addEventListener('pointercancel', end);
  }

  setupThrottle() {
    const track = $('tc-throttle');
    this.throttleFill = $('tc-throttle-fill');
    this.throttleLabel = $('tc-throttle-label');
    let pointer = null;
    const set = (e) => {
      const rect = track.getBoundingClientRect();
      this.throttleTarget = Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height));
    };
    track.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      pointer = e.pointerId;
      track.setPointerCapture(pointer);
      set(e);
    });
    track.addEventListener('pointermove', (e) => { if (e.pointerId === pointer) set(e); });
    const end = (e) => {
      if (e.pointerId !== pointer) return;
      pointer = null;
      this.throttleTarget = null; // throttle stays where the engine got to
    };
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
  }

  // Keep buttons and the throttle gauge in step with the aircraft.
  update(flight) {
    if (!this.enabled || this.root.dataset.mode !== 'flight' || !flight.mission) return;
    const m = flight.model;
    const pct = Math.round(m.throttle * 100);
    this.throttleFill.style.height = `${pct}%`;
    this.throttleLabel.textContent = `${pct}%`;
    this.flag('tc-ap', flight.autopilot.engaged);
    this.flag('tc-gear', m.gearDown);
    this.label('tc-gear', m.gearDown ? 'GEAR DN' : 'GEAR UP');
    this.label('tc-flaps', `FLAPS ${['UP', '1', 'FULL'][m.flaps]}`);
  }

  flag(id, on) { $(id).classList.toggle('active', on); }

  label(id, text) {
    const el = $(id);
    if (el.textContent !== text) el.textContent = text;
  }

  // Fullscreen + landscape lock where the browser allows it (Android Chrome).
  // Must be called from a tap handler. iPhones ignore it; the rotate screen covers them.
  static enterLandscape() {
    if (!IS_TOUCH || document.fullscreenElement) return;
    const el = document.documentElement;
    const request = el.requestFullscreen || el.webkitRequestFullscreen;
    if (!request) return;
    Promise.resolve(request.call(el, { navigationUI: 'hide' }))
      .then(() => screen.orientation?.lock?.('landscape'))
      .catch(() => {});
  }
}
