import { fromRunwayLocal } from '../world/AirfieldData.js';
import { wrapAngle } from '../utils/MathUtils.js';

// Pilot HUD for "Fly Yourself". The three instruments are drawn every frame
// on 2D canvases using 2D transformations (translate / rotate / scale):
//   compass tape       - heading scale that slides left/right (translation)
//   attitude indicator - horizon translated by pitch and rotated by -bank
//   minimap            - world points rotated by -heading so "up" is where you fly
const $ = (id) => document.getElementById(id);
const DEG = 180 / Math.PI;

function setupCanvas(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth || canvas.width;
  const h = canvas.clientHeight || canvas.height;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // scale so we can draw in CSS pixels
  return { ctx, w, h };
}

export class FlightHUD {
  constructor() {
    this.root = $('flight-hud');
    this.cache = {};
    this.canvases = null;
    this.userHidden = false;
  }

  setVisible(visible) {
    this.root.classList.toggle('hidden', !visible || this.userHidden);
    if (visible && !this.canvases) this.resize();
  }

  toggleUserHidden() {
    this.userHidden = !this.userHidden;
  }

  resize() {
    this.canvases = {
      compass: setupCanvas($('fh-compass')),
      attitude: setupCanvas($('fh-attitude')),
      map: setupCanvas($('fh-map')),
    };
  }

  text(id, value) {
    if (this.cache[id] === value) return;
    this.cache[id] = value;
    $(id).textContent = value;
  }

  flag(id, className, on) {
    const key = `${id}.${className}`;
    if (this.cache[key] === on) return;
    this.cache[key] = on;
    $(id).classList.toggle(className, on);
  }

  update({ flight, camera, night, muted, touch = false }) {
    if (this.root.classList.contains('hidden')) return;
    const m = flight.model;
    const nav = flight.navigation();
    const compass = ((180 - m.heading * DEG) % 360 + 360) % 360;

    this.text('fh-mission', flight.mission.title.toUpperCase());
    this.text('fh-time', formatTime(flight.time));
    this.text('fh-camera', camera);
    this.text('fh-mode', `${night ? 'NIGHT' : 'DAY'}${muted ? ' · MUTED' : ''}`);

    this.text('fh-speed', Math.round(m.speed * 1.944).toString());
    this.text('fh-throttle-text', `${Math.round(m.throttle * 100)}%`);
    $('fh-throttle-bar').style.width = `${m.throttle * 100}%`;
    this.text('fh-flaps', ['UP', '1', 'FULL'][m.flaps]);
    const gear = m.gearExtension >= 1 ? 'DOWN' : m.gearExtension <= 0 ? 'UP' : 'MOVING';
    this.text('fh-gear', gear);
    this.flag('fh-gear', 'good', gear === 'DOWN');
    this.flag('fh-gear', 'warn', gear === 'MOVING');
    this.text('fh-brake', m.brake && m.onGround ? 'ON' : 'OFF');
    this.flag('fh-brake', 'warn', m.brake && m.onGround);
    this.text('fh-assist', m.assist ? 'ON' : 'OFF');
    this.flag('fh-assist', 'good', m.assist);

    this.text('fh-alt', `${Math.round(m.position.y)} m`);
    this.text('fh-agl', `${Math.max(0, Math.round(m.agl))} m`);
    const fpm = Math.round((m.verticalSpeed * 196.85) / 10) * 10;
    this.text('fh-vs', `${fpm > 0 ? '+' : ''}${fpm} fpm`);
    this.text('fh-hdg', `${Math.round(compass).toString().padStart(3, '0')}°`);

    if (nav.target) {
      const eta = nav.eta ? ` · ETA ${formatTime(nav.eta)}` : '';
      this.text('fh-target', `▶ ${nav.target.name.toUpperCase()} · ${(nav.distance / 1000).toFixed(1)} km · BRG ${Math.round(nav.bearing).toString().padStart(3, '0')}°${eta}`);
    } else {
      this.text('fh-target', `FREE FLIGHT · nearest: ${nav.nearest.airport.name} ${(nav.nearest.distance / 1000).toFixed(1)} km`);
    }

    const ap = flight.autopilot.status();
    this.text('fh-ap', ap);
    this.flag('fh-ap', 'hidden', !ap);

    const warnings = flight.warnings();
    this.text('fh-warning', warnings.join('  ·  '));
    this.flag('fh-warning', 'hidden', warnings.length === 0);
    this.text('fh-hint', flight.hint(touch));

    if (!this.canvases) this.resize();
    this.drawCompass(compass, nav.target ? nav.bearing : null);
    this.drawAttitude(m.pitch, m.bank);
    this.drawMap(flight.world, m.position, compass, nav.target);
    this.text('fh-attribution', flight.world.attribution || '');
  }

  drawCompass(heading, bearing) {
    const { ctx, w, h } = this.canvases.compass;
    const cx = w / 2;
    const pxPerDeg = 3.2;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(8,18,32,0.55)';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#cfe2ff';
    ctx.fillStyle = '#e8f1ff';
    ctx.font = '600 11px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    const start = Math.floor((heading - 70) / 5) * 5;
    for (let d = start; d <= heading + 70; d += 5) {
      const x = cx + (d - heading) * pxPerDeg; // translation of the scale by the heading
      const norm = ((d % 360) + 360) % 360;
      const major = norm % 30 === 0;
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x, h - (major ? 12 : norm % 10 === 0 ? 8 : 4));
      ctx.stroke();
      if (major) {
        const label = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[norm] ?? String(norm / 10);
        ctx.fillText(label, x, h - 16);
      }
    }
    if (bearing !== null) {
      const off = wrapAngle(((bearing - heading) * Math.PI) / 180) * DEG;
      const x = Math.max(8, Math.min(w - 8, cx + off * pxPerDeg));
      ctx.fillStyle = '#55e0ff';
      ctx.beginPath();
      ctx.moveTo(x, 2);
      ctx.lineTo(x - 7, 12);
      ctx.lineTo(x + 7, 12);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#ffd400';
    ctx.fillRect(cx - 1, 0, 2, h);
  }

  drawAttitude(pitch, bank) {
    const { ctx, w, h } = this.canvases.attitude;
    const r = Math.min(w, h) / 2 - 2;
    const pxPerDeg = 2.6;
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.clip();

    ctx.save();
    ctx.rotate(-bank);                             // rotate the horizon opposite to the bank
    ctx.translate(0, pitch * DEG * pxPerDeg);      // nose up -> horizon moves down
    ctx.fillStyle = '#3f7fd0';
    ctx.fillRect(-2 * r, -4 * r, 4 * r, 4 * r);
    ctx.fillStyle = '#8a5a2b';
    ctx.fillRect(-2 * r, 0, 4 * r, 4 * r);
    ctx.strokeStyle = '#ffffff';
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-2 * r, 0);
    ctx.lineTo(2 * r, 0);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.font = '10px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    for (let p = -30; p <= 30; p += 10) {
      if (p === 0) continue;
      const y = -p * pxPerDeg;
      ctx.beginPath();
      ctx.moveTo(-18, y);
      ctx.lineTo(18, y);
      ctx.stroke();
      ctx.fillText(String(Math.abs(p)), 22, y + 3);
    }
    ctx.restore();

    // Fixed aircraft symbol
    ctx.strokeStyle = '#ffd400';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-30, 0);
    ctx.lineTo(-10, 0);
    ctx.lineTo(0, 7);
    ctx.lineTo(10, 0);
    ctx.lineTo(30, 0);
    ctx.stroke();
    ctx.restore();

    ctx.strokeStyle = 'rgba(160,200,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawMap(world, position, heading, target) {
    const { ctx, w, h } = this.canvases.map;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) / 2 - 2;
    const scale = radius / world.mapRange;
    const hr = (heading * Math.PI) / 180;
    const cos = Math.cos(hr);
    const sin = Math.sin(hr);
    // World -> map: translate by -aircraft, rotate by -heading, scale to pixels.
    const project = (x, z) => {
      const dx = x - position.x;
      const dz = z - position.z;
      return [cx + (dx * cos + dz * sin) * scale, cy + (-dx * sin + dz * cos) * scale];
    };

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(12,32,24,0.85)';
    ctx.fill();
    ctx.clip();

    // Pre-rendered ground map, placed with the same transform as a single canvas matrix.
    const map = world.map;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.translate(cx, cy);
    ctx.rotate(-hr);
    ctx.scale(scale, scale);
    ctx.translate(-position.x, -position.z);
    ctx.drawImage(map.canvas, map.minX, map.minZ, map.maxX - map.minX, map.maxZ - map.minZ);
    ctx.restore();

    ctx.strokeStyle = 'rgba(160,200,255,0.25)';
    ctx.lineWidth = 1;
    [0.33, 0.66].forEach((f) => { ctx.beginPath(); ctx.arc(cx, cy, radius * f, 0, Math.PI * 2); ctx.stroke(); });

    world.runways.forEach((r) => {
      const a = fromRunwayLocal(r, 0, r.length / 2);
      const b = fromRunwayLocal(r, 0, -r.length / 2);
      const [ax, ay] = project(a.x, a.z);
      const [bx, by] = project(b.x, b.z);
      const isTarget = target && target.id === r.airport;
      ctx.strokeStyle = isTarget ? '#55e0ff' : '#ffffff';
      ctx.lineWidth = Math.max(3, r.width * scale);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    });
    ctx.font = '600 10px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    world.airports.forEach((a) => {
      const [x, y] = project(a.x, a.z);
      const isTarget = target && target.id === a.id;
      ctx.fillStyle = isTarget ? '#55e0ff' : '#f0f5fb';
      ctx.fillText(a.iata || a.id, x, y - 10);
    });

    if (target) {
      const [gx, gy] = project(target.x, target.z);
      ctx.strokeStyle = 'rgba(85,224,255,0.7)';
      ctx.setLineDash([4, 4]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(gx, gy);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();

    // North marker on the rim
    const nx = cx + Math.sin(-hr) * (radius - 9);
    const ny = cy - Math.cos(-hr) * (radius - 9);
    ctx.fillStyle = '#ffd400';
    ctx.font = 'bold 11px "Segoe UI", system-ui, sans-serif';
    ctx.fillText('N', nx, ny + 4);

    // Aircraft symbol, always pointing up
    ctx.fillStyle = '#ffd400';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 8);
    ctx.lineTo(cx - 6, cy + 7);
    ctx.lineTo(cx, cy + 3);
    ctx.lineTo(cx + 6, cy + 7);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(160,200,255,0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function formatTime(seconds) {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
