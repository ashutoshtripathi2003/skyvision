import { fromRunwayLocal } from '../world/AirfieldData.js';

// Full-screen map (key M or the MAP button): the whole region, north up, with
// runways, taxiways, gates, airports, the aircraft, its trail and its route.
// Drag to pan, mouse wheel / pinch / buttons to zoom, click an airport to make
// it the destination.
//
// A 2D viewing transformation: screen = (world - centre) * scale + screenCentre,
// with world x -> screen x and world z (south) -> screen y (down).
const $ = (id) => document.getElementById(id);

export class MapView {
  constructor({ onSelectAirport, satellite = null }) {
    this.makeSatellite = satellite;
    this.root = $('map-view');
    this.canvas = $('mv-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.onSelectAirport = onSelectAirport;
    this.isOpen = false;
    this.centre = { x: 0, z: 0 };
    this.scale = 0.05; // pixels per metre
    this.follow = false;
    this.pointers = new Map();
    this.hover = null;

    $('mv-close').onclick = () => this.close();
    $('mv-zoom-in').onclick = () => this.zoomAt(1.6);
    $('mv-zoom-out').onclick = () => this.zoomAt(1 / 1.6);
    $('mv-centre').onclick = () => { this.follow = true; this.centre = { x: this.aircraft.x, z: this.aircraft.z }; this.scale = Math.max(this.scale, 0.25); };
    $('mv-fit').onclick = () => this.fit();

    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      c.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY });
    });
    c.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) { this.hover = this.airportAt(e.clientX, e.clientY); return; }
      if (this.pointers.size === 2) {
        // Pinch: zoom by the change in distance between the two fingers.
        const [a, b] = [...this.pointers.values()];
        const before = Math.hypot(a.x - b.x, a.y - b.y);
        p.x = e.clientX; p.y = e.clientY;
        const after = Math.hypot(a.x - b.x, a.y - b.y);
        if (before > 0) this.zoomAt(after / before, (a.x + b.x) / 2, (a.y + b.y) / 2);
        return;
      }
      this.centre.x -= (e.clientX - p.x) / this.scale;
      this.centre.z -= (e.clientY - p.y) / this.scale;
      this.follow = false;
      p.x = e.clientX; p.y = e.clientY;
    });
    const end = (e) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      if (p && this.pointers.size === 0 && Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < 6) {
        const airport = this.airportAt(e.clientX, e.clientY);
        if (airport) this.onSelectAirport(airport.id);
      }
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', (e) => this.pointers.delete(e.pointerId));
    c.addEventListener('wheel', (e) => { e.preventDefault(); this.zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.clientX, e.clientY); }, { passive: false });
    window.addEventListener('resize', () => { if (this.isOpen) this.resize(); });
  }

  open(world, flight) {
    this.world = world;
    this.flight = flight;
    this.isOpen = true;
    // The top-down photo of the region is rendered the first time the map opens.
    if (this.makeSatellite && !world.satellite) {
      try { world.satellite = this.makeSatellite(world); } catch (err) { console.warn('map image failed', err); }
    }
    this.root.classList.remove('hidden');
    this.resize();
    const p = flight.model.position;
    this.aircraft = { x: p.x, z: p.z };
    this.fit();
    // Start zoomed in on the aircraft's airport area if it is on the ground.
    if (flight.model.onGround) { this.centre = { x: p.x, z: p.z }; this.scale = 0.3; }
  }

  close() {
    this.isOpen = false;
    this.root.classList.add('hidden');
  }

  toggle(world, flight) {
    if (this.isOpen) this.close();
    else this.open(world, flight);
  }

  resize() {
    const r = Math.min(window.devicePixelRatio || 1, 2);
    this.pixelRatio = r;
    this.canvas.width = Math.round(window.innerWidth * r);
    this.canvas.height = Math.round(window.innerHeight * r);
  }

  fit() {
    const m = this.world.map;
    this.centre = { x: (m.minX + m.maxX) / 2, z: (m.minZ + m.maxZ) / 2 };
    this.scale = Math.min(window.innerWidth / (m.maxX - m.minX), window.innerHeight / (m.maxZ - m.minZ)) * 0.95;
    this.follow = false;
  }

  zoomAt(factor, sx = window.innerWidth / 2, sy = window.innerHeight / 2) {
    // Keep the world point under the cursor fixed while zooming.
    const before = this.toWorld(sx, sy);
    this.scale = Math.min(6, Math.max(0.005, this.scale * factor));
    const after = this.toWorld(sx, sy);
    this.centre.x += before.x - after.x;
    this.centre.z += before.z - after.z;
  }

  toScreen(x, z) {
    return [(x - this.centre.x) * this.scale + window.innerWidth / 2, (z - this.centre.z) * this.scale + window.innerHeight / 2];
  }

  toWorld(sx, sy) {
    return { x: (sx - window.innerWidth / 2) / this.scale + this.centre.x, z: (sy - window.innerHeight / 2) / this.scale + this.centre.z };
  }

  airportAt(sx, sy) {
    if (!this.world) return null;
    return this.world.airports.find((a) => {
      const [x, y] = this.toScreen(a.x, a.z);
      return Math.hypot(sx - x, sy - y) < 24;
    }) || null;
  }

  update() {
    if (!this.isOpen) return;
    const { ctx, world, flight } = this;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const m = flight.model;
    this.aircraft = { x: m.position.x, z: m.position.z };
    if (this.follow) this.centre = { ...this.aircraft };
    ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    ctx.fillStyle = '#0a1520';
    ctx.fillRect(0, 0, W, H);

    // Ground image (terrain colours), placed with the same transform.
    const map = world.satellite || world.map;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-this.centre.x, -this.centre.z);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(map.canvas, map.minX, map.minZ, map.maxX - map.minX, map.maxZ - map.minZ);
    ctx.restore();

    // Taxiways (from the taxi graph), when zoomed in enough to see them.
    if (world.taxiGraph && this.scale > 0.04) {
      ctx.strokeStyle = 'rgba(40,40,44,0.9)';
      ctx.lineWidth = Math.max(1, 18 * this.scale);
      ctx.lineCap = 'round';
      ctx.beginPath();
      world.taxiGraph.nodes.forEach((n, i) => n.edges.forEach((e) => {
        if (e.to < i) return;
        const t = world.taxiGraph.nodes[e.to];
        const [ax, ay] = this.toScreen(n.x, n.z);
        const [bx, by] = this.toScreen(t.x, t.z);
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
      }));
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,200,20,0.8)';
      ctx.lineWidth = Math.max(0.6, 0.8 * this.scale);
      ctx.stroke();
    }

    // Runways: true-size rectangles with their designators.
    world.runways.forEach((r) => {
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sz]) => {
        const p = fromRunwayLocal(r, (sx * r.width) / 2, (sz * r.length) / 2);
        return this.toScreen(p.x, p.z);
      });
      const target = flight.targetId === r.airport;
      ctx.fillStyle = target ? '#bff4ff' : '#e9edf1';
      ctx.strokeStyle = '#20262c';
      ctx.lineWidth = 1;
      ctx.beginPath();
      corners.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (this.scale > 0.08) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '700 12px "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        [[0, 1], [1, -1]].forEach(([k, sign]) => {
          const p = fromRunwayLocal(r, 0, sign * (r.length / 2 + 60 / Math.max(this.scale, 0.2)));
          const [x, y] = this.toScreen(p.x, p.z);
          ctx.strokeStyle = 'rgba(0,0,0,0.7)';
          ctx.lineWidth = 3;
          ctx.strokeText(r.designators[k], x, y);
          ctx.fillText(r.designators[k], x, y);
        });
      }
    });

    // Gates.
    if (world.stands && this.scale > 0.15) {
      world.stands.forEach((s) => {
        const [x, y] = this.toScreen(s.x, s.z);
        if (x < -10 || y < -10 || x > W + 10 || y > H + 10) return;
        ctx.fillStyle = s.player ? '#55e0ff' : s.occupied ? 'rgba(160,168,176,0.9)' : 'rgba(90,220,120,0.95)';
        ctx.beginPath();
        ctx.arc(x, y, Math.max(2, 4 * this.scale), 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Trail flown so far.
    if (flight.trail && flight.trail.length > 1) {
      ctx.strokeStyle = 'rgba(255,170,60,0.85)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      flight.trail.forEach(([x, z], k) => { const [sx, sy] = this.toScreen(x, z); if (k) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); });
      ctx.lineTo(...this.toScreen(m.position.x, m.position.z));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Route ahead: the taxi route, or a line to the destination.
    const target = flight.target;
    if (flight.status === 'TAXI' && flight.taxi) {
      ctx.strokeStyle = '#3cff8a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      flight.taxi.route.forEach(([x, z], k) => { const [sx, sy] = this.toScreen(x, z); if (k) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); });
      ctx.stroke();
    } else if (target) {
      ctx.strokeStyle = 'rgba(85,224,255,0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      ctx.moveTo(...this.toScreen(m.position.x, m.position.z));
      ctx.lineTo(...this.toScreen(target.x, target.z));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Airports: marker + name; the destination in cyan, the one under the pointer highlighted.
    world.airports.forEach((a) => {
      const [x, y] = this.toScreen(a.x, a.z);
      const isTarget = target && target.id === a.id;
      const isHover = this.hover && this.hover.id === a.id;
      ctx.fillStyle = isTarget ? '#55e0ff' : isHover ? '#ffd400' : '#ffffff';
      ctx.strokeStyle = '#0a1520';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, isHover ? 9 : 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = '700 14px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const label = `${a.iata || a.id} · ${a.short || a.name}${isTarget ? '  (destination)' : ''}`;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(label, x + 12, y);
      ctx.fillText(label, x + 12, y);
    });

    // Other traffic (AI airliners), in white.
    if (world.traffic) {
      world.traffic.positions.forEach((t) => {
        const [tx, ty] = this.toScreen(t.x, t.z);
        ctx.save();
        ctx.translate(tx, ty);
        ctx.rotate(Math.atan2(Math.sin(t.heading), -Math.cos(t.heading)));
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, -9); ctx.lineTo(8, 4); ctx.lineTo(0, 1); ctx.lineTo(-8, 4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      });
    }

    // The aircraft: pointing along its heading (map is north-up).
    const [ax, ay] = this.toScreen(m.position.x, m.position.z);
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(Math.atan2(Math.sin(m.heading), -Math.cos(m.heading)));
    ctx.fillStyle = '#ffd400';
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -13); ctx.lineTo(3, -4); ctx.lineTo(12, 2); ctx.lineTo(12, 5); ctx.lineTo(3, 2); ctx.lineTo(2, 9);
    ctx.lineTo(5, 12); ctx.lineTo(-5, 12); ctx.lineTo(-2, 9); ctx.lineTo(-3, 2); ctx.lineTo(-12, 5); ctx.lineTo(-12, 2); ctx.lineTo(-3, -4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Scale bar.
    const nice = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
    const metres = nice.find((n) => n * this.scale > 80) || 10000;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(20, H - 30, metres * this.scale, 3);
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(metres >= 1000 ? `${metres / 1000} km` : `${metres} m`, 20, H - 40);
    ctx.textAlign = 'center';
    ctx.fillText('N ▲', W - 40, 80);

    const info = target
      ? `Destination ${target.short || target.name} · ${(Math.hypot(target.x - m.position.x, target.z - m.position.z) / 1000).toFixed(1)} km`
      : 'Free flight · click an airport to set a destination';
    $('mv-info').textContent = info;
  }
}
