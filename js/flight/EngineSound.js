// Procedural engine sound with the Web Audio API (no audio files):
//   filtered noise = turbine roar, sawtooth oscillator = engine hum, second noise = wind.
// Pitch and volume follow throttle and airspeed.
export class EngineSound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.active = false;
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

    const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const makeNoise = () => {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;
      src.start();
      return src;
    };

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    this.roarFilter = ctx.createBiquadFilter();
    this.roarFilter.type = 'lowpass';
    this.roarGain = ctx.createGain();
    makeNoise().connect(this.roarFilter).connect(this.roarGain).connect(this.master);

    this.hum = ctx.createOscillator();
    this.hum.type = 'sawtooth';
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 400;
    this.humGain = ctx.createGain();
    this.hum.connect(humFilter).connect(this.humGain).connect(this.master);
    this.hum.start();

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    makeNoise().connect(this.windFilter).connect(this.windGain).connect(this.master);
  }

  stop() {
    this.active = false;
    if (this.ctx) this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.2);
  }

  toggleMute() {
    this.muted = !this.muted;
    return this.muted;
  }

  update(throttle, speed) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const on = this.active && !this.muted;
    this.master.gain.setTargetAtTime(on ? 0.5 : 0, t, 0.15);
    this.roarFilter.frequency.setTargetAtTime(300 + throttle * 1500, t, 0.3);
    this.roarGain.gain.setTargetAtTime(0.12 + throttle * 0.35, t, 0.3);
    this.hum.frequency.setTargetAtTime(55 + throttle * 70, t, 0.3);
    this.humGain.gain.setTargetAtTime(0.05 + throttle * 0.08, t, 0.3);
    this.windFilter.frequency.setTargetAtTime(400 + speed * 18, t, 0.3);
    this.windGain.gain.setTargetAtTime(Math.min(0.35, speed / 220), t, 0.3);
  }
}
