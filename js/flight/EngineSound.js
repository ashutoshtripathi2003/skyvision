// Procedural aircraft sound with the Web Audio API (no audio files). Every
// sound is built from two sources - noise and oscillators - shaped by filters
// and gain envelopes:
//
//   engine rumble : low-passed "brown" noise, louder and brighter with thrust
//   fan whine     : two slightly detuned sine tones whose pitch follows N1 (thrust)
//   hum           : a low sine tone
//   wind          : band-passed noise that rises with airspeed
//   runway roll   : low rumble + a soft thump at every concrete joint while on the ground
//   reversers     : a broad roar after touchdown while the thrust reversers are out
//   one-shots     : tyre chirp + thud on touchdown (scaled by the sink rate), gear
//                   clunk, and the crash
//
// The continuous sounds go through a compressor into a quiet master gain, so
// they stay in the background; the one-shots (touchdown, gear, crash) bypass the
// compressor so they still hit hard.
const MASTER = 0.22;

export class EngineSound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.active = false;
    this.rolled = 0;       // distance rolled since the last runway-joint thump
    this.n1 = 0;           // engine spool (lags behind the throttle like a real turbofan)
  }

  // Browsers only allow audio after a user click, so this is called from a button handler.
  start() {
    this.active = true;
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    this.ctx = ctx;

    const seconds = 3;
    const white = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const brown = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const w = white.getChannelData(0);
    const b = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < w.length; i++) {
      w[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * w[i]) / 1.02; // integrated white noise = deeper "brown" noise
      b[i] = last * 3.5;
    }
    this.white = white;

    const loop = (buffer) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      src.loopStart = Math.random() * 0.5;
      src.start(0, Math.random() * seconds);
      return src;
    };
    const filter = (type, frequency, Q = 0.7) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = frequency;
      f.Q.value = Q;
      return f;
    };
    const gain = (value = 0) => {
      const g = ctx.createGain();
      g.gain.value = value;
      return g;
    };

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 4;
    this.master = gain(0);
    this.master.connect(ctx.destination);
    this.bus = ctx.createGain();           // continuous engine / wind / runway sounds
    this.bus.connect(compressor).connect(this.master);
    this.fx = ctx.createGain();            // one-shot sounds
    this.fx.connect(this.master);

    // Engine rumble.
    this.rumbleFilter = filter('lowpass', 200);
    this.rumbleGain = gain();
    loop(brown).connect(this.rumbleFilter).connect(this.rumbleGain).connect(this.bus);

    // Fan whine: two sines a few Hz apart beat against each other like two engines.
    this.whine = [ctx.createOscillator(), ctx.createOscillator()];
    this.whineGain = gain();
    const whineFilter = filter('bandpass', 1500, 1.2);
    this.whine.forEach((o) => { o.type = 'sine'; o.connect(whineFilter); o.start(); });
    whineFilter.connect(this.whineGain).connect(this.bus);

    // Low hum.
    this.hum = ctx.createOscillator();
    this.hum.type = 'sine';
    this.humGain = gain();
    this.hum.connect(this.humGain).connect(this.bus);
    this.hum.start();

    // Wind over the airframe.
    this.windFilter = filter('bandpass', 500, 0.5);
    this.windGain = gain();
    loop(white).connect(this.windFilter).connect(this.windGain).connect(this.bus);

    // Runway roll rumble.
    this.rollFilter = filter('lowpass', 120);
    this.rollGain = gain();
    loop(brown).connect(this.rollFilter).connect(this.rollGain).connect(this.bus);

    // Thrust reverser roar.
    this.reverseFilter = filter('bandpass', 700, 0.6);
    this.reverseGain = gain();
    loop(white).connect(this.reverseFilter).connect(this.reverseGain).connect(this.bus);
  }

  stop() {
    this.active = false;
    if (this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.6);
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  // state: { throttle, speed, onGround, reverse, size, dt }
  update(state) {
    if (!this.ctx) return;
    const { throttle = 0, speed = 0, onGround = false, reverse = false, size = 1, dt = 1 / 60 } = state || {};
    const t = this.ctx.currentTime;
    const on = this.active && !this.muted;
    this.master.gain.setTargetAtTime(on ? MASTER : 0, t, 0.25);
    if (!on) return;

    // Turbofans spool up and down slowly (a few seconds from idle to full power).
    const target = reverse && speed > 8 ? 0.75 : throttle;
    this.n1 += (target - this.n1) * Math.min(1, dt * (target > this.n1 ? 0.6 : 0.9));
    const n1 = 0.22 + 0.78 * this.n1;       // idle is ~22% N1
    const deep = Math.min(1.6, Math.sqrt(size)); // bigger engines sound deeper

    this.rumbleFilter.frequency.setTargetAtTime((140 + n1 * n1 * 700) / deep, t, 0.2);
    this.rumbleGain.gain.setTargetAtTime(0.18 + n1 ** 1.6 * 0.55, t, 0.2);
    const whineHz = (700 + n1 * 1900) / deep;
    this.whine[0].frequency.setTargetAtTime(whineHz, t, 0.3);
    this.whine[1].frequency.setTargetAtTime(whineHz * 1.004 + 3, t, 0.3);
    this.whineGain.gain.setTargetAtTime(0.012 + n1 * 0.035, t, 0.3);
    this.hum.frequency.setTargetAtTime((38 + n1 * 34) / deep, t, 0.3);
    this.humGain.gain.setTargetAtTime(0.05 + n1 * 0.05, t, 0.3);

    const air = Math.min(1, speed / 140);
    this.windFilter.frequency.setTargetAtTime(250 + speed * 7, t, 0.3);
    this.windGain.gain.setTargetAtTime(air * air * 0.22, t, 0.3);

    const rolling = onGround ? Math.min(1, speed / 70) : 0;
    this.rollFilter.frequency.setTargetAtTime(70 + rolling * 110, t, 0.1);
    this.rollGain.gain.setTargetAtTime(rolling * 0.7, t, 0.1);
    this.reverseFilter.frequency.setTargetAtTime(500 + Math.min(speed, 80) * 6, t, 0.2);
    this.reverseGain.gain.setTargetAtTime(reverse && speed > 8 ? Math.min(0.35, speed / 160) : 0, t, reverse ? 0.5 : 0.8);

    // A soft thump every ~20 m of runway (the joints between concrete slabs).
    if (onGround && speed > 3) {
      this.rolled += speed * dt;
      if (this.rolled > 20) {
        this.rolled = 0;
        this.thud(0.04 + rolling * 0.1, 55 + Math.random() * 15, 0.12);
      }
    }
  }

  // ---- one-shot sounds ------------------------------------------------------

  // Short burst of filtered noise with an attack/decay envelope.
  noiseBurst({ type = 'bandpass', frequency = 1000, Q = 1, peak = 0.3, attack = 0.005, decay = 0.2, delay = 0, sweepTo = null }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(frequency, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + decay);
    f.Q.value = Q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    src.connect(f).connect(g).connect(this.fx);
    src.start(t, Math.random() * 2);
    src.stop(t + attack + decay + 0.05);
  }

  // Low sine that drops in pitch: a thud felt more than heard.
  thud(peak, frequency, decay, delay = 0) {
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(frequency, t);
    o.frequency.exponentialRampToValueAtTime(frequency * 0.55, t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    o.connect(g).connect(this.fx);
    o.start(t);
    o.stop(t + decay + 0.05);
  }

  // Touchdown: both main gears hit a split second apart - a tyre "chirp" (the
  // wheels spinning up from 0 to landing speed) and a thud through the airframe.
  touchdown(fpm = 200, size = 1) {
    if (!this.ctx || this.muted || !this.active) return;
    const firm = Math.min(1, Math.max(0.25, fpm / 500));
    [0, 0.07 + Math.random() * 0.05].forEach((delay, i) => {
      this.noiseBurst({ frequency: 2600 - i * 300, Q: 3, peak: 0.35 * firm, decay: 0.16 + firm * 0.12, delay, sweepTo: 1300 });
      this.noiseBurst({ type: 'lowpass', frequency: 900, peak: 0.35 * firm, decay: 0.3, delay });
      this.thud(0.7 + 0.6 * firm, 70 / Math.sqrt(size), 0.35 + firm * 0.25, delay);
    });
    // The nose gear comes down a moment later.
    this.thud(0.25 * firm, 85, 0.25, 1.4 + Math.random() * 0.6);
    this.rolled = 0;
  }

  // Gear moving: a hydraulic whirr and a clunk as it locks.
  gear(down) {
    if (!this.ctx || this.muted || !this.active) return;
    this.noiseBurst({ frequency: 400, Q: 2, peak: 0.08, attack: 0.3, decay: 1.8, sweepTo: down ? 250 : 600 });
    this.thud(0.35, 90, 0.2, down ? 2.2 : 1.8);
    this.noiseBurst({ type: 'lowpass', frequency: 700, peak: 0.18, decay: 0.12, delay: down ? 2.2 : 1.8 });
  }

  crash() {
    if (!this.ctx || this.muted) return;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setValueAtTime(MASTER, this.ctx.currentTime);
    this.noiseBurst({ type: 'lowpass', frequency: 1800, peak: 0.9, attack: 0.01, decay: 2.5, sweepTo: 120 });
    this.thud(1, 60, 1.4);
    this.noiseBurst({ type: 'bandpass', frequency: 3000, Q: 0.8, peak: 0.25, decay: 0.8, delay: 0.05 });
    this.active = false;
    this.master.gain.setTargetAtTime(0, this.ctx.currentTime + 1.5, 1);
  }
}
