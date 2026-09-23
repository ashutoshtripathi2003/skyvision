const $ = (id) => document.getElementById(id);

// Heads-up display: camera, day/night mode, flight phase, animation state and telemetry.
export class HUD {
  constructor() {
    this.root = $('hud');
    this.fields = {
      camera: $('hud-camera'), mode: $('hud-mode'), flight: $('hud-flight'), step: $('hud-step'),
      anim: $('hud-anim'), speed: $('hud-speed'), alt: $('hud-alt'), spd: $('hud-spd'),
      hdg: $('hud-hdg'), progress: $('hud-progress'), prompt: $('hud-prompt'), clip: $('hud-clip-row'),
    };
    this.toastEl = $('toast');
    this.toastTimer = null;
    this.userHidden = false;
    this.cache = {};
  }

  setVisible(visible) {
    this.root.classList.toggle('hidden', !visible || this.userHidden);
  }

  toggleUserHidden() {
    this.userHidden = !this.userHidden;
    this.setVisible(true);
  }

  // Only touch the DOM when a value actually changes.
  set(name, value) {
    if (this.cache[name] === value) return;
    this.cache[name] = value;
    this.fields[name].textContent = value;
  }

  update({ camera, night, flight, simSpeed, clipping, touch = false }) {
    const root = flight.aircraft.root;
    this.set('camera', camera);
    this.set('mode', night ? 'NIGHT' : 'DAY');
    this.set('flight', flight.phaseLabel);
    this.set('step', flight.stepText);
    this.set('anim', flight.status);
    this.set('speed', `${simSpeed}x`);
    this.set('alt', `${Math.max(0, root.position.y).toFixed(0)} m`);
    this.set('spd', `${(flight.speed * 1.944).toFixed(0)} kt`);
    this.set('hdg', `${flight.compassHeading.toFixed(0).padStart(3, '0')}°`);

    const pct = flight.status === 'COMPLETE' ? 100 : ((flight.phase.step - 1) / 10) * 100;
    this.fields.progress.style.width = `${pct}%`;
    this.fields.prompt.classList.toggle('hidden', flight.status !== 'READY' && flight.status !== 'COMPLETE');
    const start = touch ? 'tap ▶' : 'press SPACE';
    this.set('prompt', flight.status === 'COMPLETE'
      ? `Flight complete — ${start} to fly again`
      : `${touch ? 'Tap ▶' : 'Press SPACE'} to start the flight`);
    this.fields.clip.classList.toggle('hidden', !clipping);
  }

  toast(message) {
    this.toastEl.textContent = message;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 1400);
  }
}
