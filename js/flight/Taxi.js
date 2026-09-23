import * as THREE from 'three';
import { toRunwayLocal } from '../world/AirfieldData.js';
import { clamp, wrapAngle } from '../utils/MathUtils.js';

// After landing the aircraft taxis itself to a free stand at the terminal.
//
// 1. TaxiGraph: every taxiway centreline is a polyline; its points become graph
//    nodes (points shared by two taxiways join them) and each segment an edge
//    weighted by its length.
// 2. planTaxi: pick the next runway exit ahead, run Dijkstra's shortest-path
//    algorithm from it, and choose the free stand that is cheapest to reach
//    (preferring stands at a jet bridge).
// 3. TaxiController: "pure pursuit" steering - always steer towards a point a
//    fixed distance further along the route - with speed slowing for turns and
//    for the stop at the stand.

export class TaxiGraph {
  constructor(polylines) {
    this.nodes = [];
    const index = new Map();
    const key = (x, z) => `${Math.round(x)}|${Math.round(z)}`; // points within ~1 m merge into one node
    const nodeAt = (x, z) => {
      const k = key(x, z);
      if (!index.has(k)) {
        index.set(k, this.nodes.length);
        this.nodes.push({ x, z, edges: [] });
      }
      return index.get(k);
    };
    polylines.forEach((p) => {
      let prev = null;
      for (let i = 0; i < p.length; i += 2) {
        const id = nodeAt(p[i], p[i + 1]);
        if (prev !== null && prev !== id) {
          const a = this.nodes[prev];
          const b = this.nodes[id];
          const w = Math.hypot(a.x - b.x, a.z - b.z);
          a.edges.push({ to: id, w });
          b.edges.push({ to: prev, w });
        }
        prev = id;
      }
    });
  }

  nearest(x, z, filter = () => true) {
    let best = -1;
    let bestD = Infinity;
    this.nodes.forEach((n, i) => {
      const d = Math.hypot(n.x - x, n.z - z);
      if (d < bestD && filter(n, i)) { bestD = d; best = i; }
    });
    return { id: best, distance: bestD };
  }

  // Dijkstra's algorithm with a simple binary heap.
  shortestFrom(start) {
    const dist = new Float64Array(this.nodes.length).fill(Infinity);
    const prev = new Int32Array(this.nodes.length).fill(-1);
    const heap = [[0, start]];
    dist[start] = 0;
    const push = (item) => {
      heap.push(item);
      let i = heap.length - 1;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heap[p][0] <= heap[i][0]) break;
        [heap[p], heap[i]] = [heap[i], heap[p]];
        i = p;
      }
    };
    const pop = () => {
      const top = heap[0];
      const last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
          if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    while (heap.length) {
      const [d, u] = pop();
      if (d > dist[u]) continue;
      this.nodes[u].edges.forEach(({ to, w }) => {
        if (d + w < dist[to]) {
          dist[to] = d + w;
          prev[to] = u;
          push([dist[to], to]);
        }
      });
    }
    return { dist, prev };
  }

  pathTo(prev, end) {
    const ids = [];
    for (let v = end; v !== -1; v = prev[v]) ids.push(v);
    return ids.reverse().map((i) => [this.nodes[i].x, this.nodes[i].z]);
  }
}

// Plan the route from where the aircraft is (on the runway) to a free stand.
// size: aircraft size (1 = trainer); noseOffset: distance from the main gear
// (the aircraft origin) forward to the nose wheel, which stops on the stand point;
// fits(stand): whether the aircraft's wingspan fits at that stand.
export function planTaxi(world, runway, position, heading, { size = 1, noseOffset = 0, fits = () => true } = {}) {
  const graph = world.taxiGraph;
  if (!graph || graph.nodes.length === 0 || !world.stands) return null;
  const airportStands = world.stands.filter((s) => s.airport === runway.airport && !s.occupied && fits(s));
  if (airportStands.length === 0) return null;

  // Runway exits: taxiway nodes on or right beside the runway, preferably ahead of us.
  const forward = new THREE.Vector2(Math.sin(heading), Math.cos(heading));
  const exits = [];
  graph.nodes.forEach((n, i) => {
    const local = toRunwayLocal(runway, n.x, n.z);
    if (Math.abs(local.x) > runway.width / 2 + 25 || Math.abs(local.z) > runway.length / 2 + 20) return;
    const ahead = (n.x - position.x) * forward.x + (n.z - position.z) * forward.y;
    if (n.edges.length > 0) exits.push({ id: i, ahead });
  });
  if (exits.length === 0) return null;
  const aheadExits = exits.filter((e) => e.ahead > 10 * size).sort((a, b) => a.ahead - b.ahead);
  const exit = aheadExits[0] || exits.sort((a, b) => Math.abs(a.ahead) - Math.abs(b.ahead))[0];

  const { dist, prev } = graph.shortestFrom(exit.id);
  const entryDistance = 55 * size;
  let best = null;
  airportStands.forEach((stand) => {
    const sx = Math.sin(stand.heading);
    const sz = Math.cos(stand.heading);
    const ex = stand.x - sx * entryDistance;
    const ez = stand.z - sz * entryDistance;
    // Join from a taxiway node well behind the stand, so the aircraft can roll straight in nose first.
    const behind = (n) => (n.x - stand.x) * sx + (n.z - stand.z) * sz < -(noseOffset + 20 * size);
    const entry = graph.nearest(ex, ez, (n, i) => dist[i] < Infinity && behind(n));
    if (entry.id < 0 || entry.distance > 150) return;
    const cost = dist[entry.id] + entry.distance * 2 + (stand.contact ? 0 : 900);
    if (!best || cost < best.cost) best = { cost, stand, entry: entry.id };
  });
  if (!best) return null;

  // Graph path, then straight in along the stand's lead-in line until the nose wheel is on the stop mark.
  const route = [[position.x, position.z], ...graph.pathTo(prev, best.entry)];
  const { stand } = best;
  const fx = Math.sin(stand.heading);
  const fz = Math.cos(stand.heading);
  // The lead-in point lies on the stand centreline, level with the taxiway node we
  // leave from (at least 60 m back), so the aircraft turns onto the centreline and
  // then rolls straight in.
  const [nx, nz] = route[route.length - 1];
  const leadIn = Math.max(noseOffset + 60 * size, -((nx - stand.x) * fx + (nz - stand.z) * fz));
  const offCentreline = Math.abs((nx - stand.x) * fz - (nz - stand.z) * fx);
  if (offCentreline > 3) route.push([stand.x - fx * leadIn, stand.z - fz * leadIn]); // (not needed if already on it)
  route.push([stand.x - fx * noseOffset, stand.z - fz * noseOffset]);
  return { route: simplify(route), stand };
}

// Drop points closer than 3 m to the previous one (duplicate / tiny segments).
function simplify(points) {
  const out = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const [x, z] = points[i];
    const [px, pz] = out[out.length - 1];
    if (Math.hypot(x - px, z - pz) > 3 || i === points.length - 1) out.push(points[i]);
  }
  return out;
}

export class TaxiController {
  constructor(model, plan, size) {
    this.model = model;
    this.route = plan.route;
    this.stand = plan.stand;
    this.size = size;
    this.cumulative = [0];
    for (let i = 1; i < this.route.length; i++) {
      const [x0, z0] = this.route[i - 1];
      const [x1, z1] = this.route[i];
      this.cumulative.push(this.cumulative[i - 1] + Math.hypot(x1 - x0, z1 - z0));
    }
    this.total = this.cumulative[this.cumulative.length - 1];
    this.progress = 0;
    this.done = false;
  }

  get remaining() { return Math.max(0, this.total - this.progress); }

  // Point at distance d along the route. Beyond the end it continues straight
  // along the last segment (the stand's lead-in line), so steering towards it
  // lines the aircraft up with the stand instead of just aiming at the stop mark.
  pointAt(d) {
    const c = this.cumulative;
    let i = 1;
    while (i < c.length - 1 && c[i] < d) i++;
    const last = i === c.length - 1;
    const t = Math.max(0, (d - c[i - 1]) / Math.max(0.001, c[i] - c[i - 1]));
    if (!last && t > 1) return this.route[i];
    const [x0, z0] = this.route[i - 1];
    const [x1, z1] = this.route[i];
    return [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t];
  }

  // Project the aircraft onto the route (search only forward, so it never jumps back).
  updateProgress() {
    const p = this.model.position;
    let best = this.progress;
    let bestD = Infinity;
    for (let d = this.progress; d <= Math.min(this.total, this.progress + 80); d += 2) {
      const [x, z] = this.pointAt(d);
      const dd = Math.hypot(x - p.x, z - p.z);
      if (dd < bestD) { bestD = dd; best = d; }
    }
    this.progress = best;
  }

  controls() {
    const m = this.model;
    this.updateProgress();
    // At the stop mark (or just past it): brakes on until stationary.
    const [ex, ez] = this.route[this.route.length - 1];
    const toEnd = Math.hypot(ex - m.position.x, ez - m.position.z);
    const endBehind = (ex - m.position.x) * Math.sin(m.heading) + (ez - m.position.z) * Math.cos(m.heading) < 0;
    if (this.remaining < 1.5 || toEnd < 1.5 || (this.remaining < 15 && endBehind)) this.stopping = true;
    if (this.stopping) {
      if (m.speed < 0.3) this.done = true;
      return { pitch: 0, roll: 0, yaw: 0, throttle: -1, brake: true };
    }
    const lookahead = clamp(m.speed * 1.6, 10, 22) * Math.min(1.3, Math.sqrt(this.size / 1.4));
    const [tx, tz] = this.pointAt(this.progress + lookahead);
    const desired = Math.atan2(tx - m.position.x, tz - m.position.z);
    const headingError = wrapAngle(m.heading - desired);

    // Slow down before sharp turns and for the final stop.
    const [ax, az] = this.pointAt(Math.min(this.total, this.progress + 8));
    const [bx, bz] = this.pointAt(Math.min(this.total, this.progress + 45));
    const upcomingTurn = Math.abs(wrapAngle(Math.atan2(bx - ax, bz - az) - desired));
    let target = upcomingTurn > 0.7 ? 4.5 : upcomingTurn > 0.35 ? 7 : 11;
    target = Math.min(target, Math.sqrt(2 * 0.7 * this.remaining) + 0.4); // v^2 = 2as: gentle stop at the mark
    if (Math.abs(headingError) > 0.6) target = Math.min(target, 4);

    // Throttle position: just enough to beat rolling friction (feed-forward) plus a
    // little for the speed error - taxiing is done at little more than idle thrust.
    const idle = m.perf.rollingFriction / m.perf.thrust;
    const lever = clamp(idle + (target - m.speed) * 0.08, 0, 0.35);
    return {
      pitch: 0,
      roll: clamp(headingError * 2.6, -1, 1),
      yaw: 0,
      throttle: clamp((lever - m.throttle) * 4, -1, 1),
      brake: m.speed > target + 1.2,
    };
  }
}
