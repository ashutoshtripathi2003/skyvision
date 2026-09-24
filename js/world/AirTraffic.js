import * as THREE from 'three';
import { Aircraft } from '../aircraft/Aircraft.js';
import { AIRCRAFT_TYPES, PERFORMANCE_BY_TYPE, A320_WORLD_SCALE } from '../aircraft/AircraftTypes.js';
import { FLEET_MIX } from '../aircraft/Liveries.js';
import { FlightModel } from '../flight/FlightModel.js';
import { Autopilot } from '../flight/Autopilot.js';
import { spawnFor } from '../flight/Missions.js';
import { planTaxi, TaxiController } from '../flight/Taxi.js';
import { toRunwayLocal } from './AirfieldData.js';

// Other airliners at the real airports. Nothing is scripted: every AI aircraft
// flies the same flight model and autopilot as the player.
//   arrival:   starts ~7 km out on final, autolands, then taxis along the real
//              taxiways to a free gate (Dijkstra + pure pursuit) and parks
//   departure: lines up on the runway, takes off, raises the gear and climbs
//              away, and disappears ~12 km out
// A new movement starts every minute or two, on a runway the player is not using.
const DEFAULT_MIX = { indigo: 40, airindia: 25, akasa: 12, spicejet: 8, aiexpress: 15 };
const MAX_AIRCRAFT = 4;
const WIDE = { a320: 0, a350: 58, a380: 75 }; // stand spacing needed for the wingspan
const STEP = 1 / 30;

class AIFlight {
  constructor(world, aircraft, type, targetId) {
    this.world = world;
    this.aircraft = aircraft;
    this.type = type;
    this.targetId = targetId;
    this.model = new FlightModel();
    this.autopilot = new Autopilot(this);
    const spec = AIRCRAFT_TYPES[type];
    this.spec = spec;
    this.modelScale = world.aircraftScale / A320_WORLD_SCALE;
    this.size = world.aircraftScale * (spec.length / AIRCRAFT_TYPES.a320.length);
    this.model.setPerformance(PERFORMANCE_BY_TYPE[type], spec.bellyClearance * this.modelScale);
    this.status = 'FLYING';
  }

  get target() { return this.world.airports.find((a) => a.id === this.targetId) || null; }
}

export class AirTraffic {
  constructor(world, parent) {
    this.world = world;
    this.parent = parent;
    this.flights = [];
    this.timer = 20 + Math.random() * 20; // first movement soon after arriving
    this.accumulator = 0;
    this.nextIsArrival = true;
    // Airports with real airline traffic (a long runway and gates).
    this.airports = world.airports.filter((a) => world.runways.some((r) => r.airport === a.id && r.length > 1800)
      && world.stands.some((s) => s.airport === a.id));
  }

  // Runways the player is using (on it, or lined up on final for it) are avoided.
  runwayBusy(runway, player) {
    // Another AI aircraft still using it (landing, rolling out or taking off)?
    if (this.flights.some((f) => f.runway === runway && ['APPROACH', 'TAKEOFF'].includes(f.phase))) return true;
    if (!player || !player.mission || player.world !== this.world) return false;
    const p = player.model.position;
    const local = toRunwayLocal(runway, p.x, p.z);
    const onIt = Math.abs(local.x) < runway.width + 60 && Math.abs(local.z) < runway.length / 2 + 400;
    const onFinal = Math.abs(local.x) < 900 && Math.abs(local.z) < runway.length / 2 + 14000 && p.y - runway.y < 900;
    return onIt || onFinal;
  }

  spawn(player) {
    if (this.airports.length === 0) return;
    if (this.flights.length >= MAX_AIRCRAFT) {
      // Make room: remove the aircraft that parked longest ago.
      const parked = this.flights.filter((f) => f.phase === 'PARKED').sort((a, b) => a.parkedAt - b.parkedAt)[0];
      if (!parked) return;
      this.remove(parked);
    }
    const airport = this.airports[Math.floor(Math.random() * this.airports.length)];
    const runways = this.world.runways.filter((r) => r.airport === airport.id && r.length > 1800 && !this.runwayBusy(r, player));
    if (runways.length === 0) return;
    const runway = runways.sort((a, b) => b.length - a.length)[Math.random() < 0.75 ? 0 : runways.length - 1];
    const label = runway.designators[Math.random() < 0.5 ? 0 : 1];

    const mix = FLEET_MIX[airport.id] || DEFAULT_MIX;
    let livery = pickWeighted(mix);
    let type = 'a320';
    const r = Math.random();
    const roomFor = (span) => this.world.stands.some((s) => s.airport === airport.id && s.spacing >= span);
    if (r < 0.12 && roomFor(WIDE.a350)) { type = 'a350'; livery = 'airindia'; } else if (r < 0.18 && roomFor(WIDE.a380)) { type = 'a380'; livery = 'skyvision'; }

    const aircraft = new Aircraft({ type, livery, withLights: true });
    const flight = new AIFlight(this.world, aircraft, type, airport.id);
    aircraft.root.scale.setScalar(flight.modelScale);
    const arrival = this.nextIsArrival;
    this.nextIsArrival = !this.nextIsArrival;
    const spawn = spawnFor(this.world, airport.id, label, arrival ? 'final' : 'runway', { perf: flight.model.perf, size: flight.size });
    flight.model.reset({ ...spawn, position: new THREE.Vector3(spawn.position.x, spawn.position.y, spawn.position.z) });
    flight.model.agl = spawn.position.y - this.world.heightAt(spawn.position.x, spawn.position.z);
    flight.runway = runway;
    flight.phase = arrival ? 'APPROACH' : 'TAKEOFF';
    flight.age = 0;
    if (arrival) flight.autopilot.engage();
    aircraft.root.visible = false; // shown once the detailed model is ready
    aircraft.modelPromise.then(() => { aircraft.root.visible = true; });
    this.parent.add(aircraft.root);
    this.flights.push(flight);
    this.sync(flight);
  }

  remove(flight) {
    this.parent.remove(flight.aircraft.root);
    if (flight.stand) { flight.stand.occupied = false; flight.stand.ai = false; }
    this.flights.splice(this.flights.indexOf(flight), 1);
  }

  sync(f) {
    const root = f.aircraft.root;
    root.position.copy(f.model.position);
    root.quaternion.copy(f.model.quaternion);
    f.aircraft.setGearExtension(f.model.gearExtension);
    f.aircraft.landingLightOn = f.model.gearDown && f.phase !== 'PARKED';
    f.aircraft.setEngineSpin(f.phase === 'PARKED' ? 0 : f.model.throttle);
  }

  step(f) {
    const m = f.model;
    let controls = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false };
    if (f.phase === 'TAKEOFF') {
      // Full power, rotate at ~1.05 x stall speed, climb at ~7 degrees, then hand over to the autopilot.
      const targetPitch = m.onGround ? (m.speed > m.stallSpeed * 1.05 ? 0.18 : 0) : 0.12;
      controls = { pitch: m.pitch < targetPitch - 0.01 ? 1 : m.pitch > targetPitch + 0.01 ? -1 : 0, roll: 0, yaw: 0, throttle: 1, brake: false };
      if (!m.onGround && m.agl > 120 * this.world.aircraftScale) {
        f.targetId = null; // climb out on the runway heading
        f.autopilot.engage();
        f.autopilot.hold.altitude = m.position.y + 1400;
        f.autopilot.hold.speed = m.perf.stallSpeed[0] * 1.6;
        f.phase = 'CLIMB';
      }
    } else if (f.phase === 'APPROACH' || f.phase === 'CLIMB') {
      controls = f.autopilot.controls(STEP);
      if (f.phase === 'APPROACH' && m.onGround && m.speed < 14) {
        const noseOffset = (f.spec.gear.nose.z + 1) * f.modelScale;
        const options = { size: f.size, noseOffset, fits: (s) => s.spacing === undefined || s.spacing >= WIDE[f.type] };
        const plan = planTaxi(this.world, f.runway, m.position, m.heading, options)
          || planTaxi(this.world, f.runway, m.position, m.heading, { ...options, fits: () => true });
        if (plan) {
          f.taxi = new TaxiController(m, plan, f.size);
          f.stand = plan.stand;
          plan.stand.occupied = true;
          plan.stand.ai = true;
          f.phase = 'TAXI';
        } else f.phase = 'VACATE';
      }
      if (f.phase === 'CLIMB') {
        const a = this.world.airports.find((x) => x.id === f.runway.airport);
        if (Math.hypot(m.position.x - a.x, m.position.z - a.z) > 12000) f.phase = 'DEPARTED';
      }
    } else if (f.phase === 'TAXI') {
      controls = f.taxi.controls();
      if (f.taxi.done) { f.phase = 'PARKED'; f.parkedAt = performance.now(); m.throttle = 0; m.speed = 0; }
    } else if (f.phase === 'VACATE') {
      controls = { pitch: 0, roll: 0, yaw: 0, throttle: -1, brake: true };
      if (m.speed < 0.5) f.phase = 'DEPARTED'; // no free gate: disappears
    }
    if (f.phase !== 'PARKED' && f.phase !== 'DEPARTED') m.update(STEP, controls, this.world.heightAt);
  }

  // Fixed 30 Hz simulation steps (independent of the frame rate).
  update(dt, player, elapsed, night) {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 60 + Math.random() * 70;
      this.spawn(player);
    }
    this.accumulator = Math.min(this.accumulator + dt, 0.25);
    while (this.accumulator >= STEP) {
      this.accumulator -= STEP;
      this.flights.forEach((f) => this.step(f));
    }
    this.flights.forEach((f) => {
      f.age += dt;
      this.sync(f);
      f.aircraft.updateLights(elapsed, night);
    });
    this.flights.filter((f) => f.phase === 'DEPARTED' || (f.age > 900 && f.phase !== 'PARKED')).forEach((f) => this.remove(f));
  }

  // For the map: positions and headings of the AI aircraft.
  get positions() {
    return this.flights.filter((f) => f.phase !== 'DEPARTED').map((f) => ({ x: f.model.position.x, z: f.model.position.z, heading: f.model.heading, onGround: f.model.onGround }));
  }

  clear() {
    [...this.flights].forEach((f) => this.remove(f));
  }
}

function pickWeighted(mix) {
  const total = Object.values(mix).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const [key, w] of Object.entries(mix)) { r -= w; if (r <= 0) return key; }
  return Object.keys(mix)[0];
}

