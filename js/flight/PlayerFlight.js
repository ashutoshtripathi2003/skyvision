import * as THREE from 'three';
import { FlightModel } from './FlightModel.js';
import { spawnFor } from './Missions.js';
import { Autopilot } from './Autopilot.js';
import { toRunwayLocal } from '../world/AirfieldData.js';
import { wrapAngle, radToDeg } from '../utils/MathUtils.js';

// Game logic for "Fly Yourself": reads the keyboard, runs the flight model,
// judges every touchdown and decides between LANDED, ROLLOUT and CRASHED.
// Works in any world (SkyVision valley or real-world Mumbai) through the
// world interface: heightAt / isWater / slopeAt / obstacleAt / runways / airports.
//
// status: GROUND (before takeoff) | FLYING | ROLLOUT (after touchdown) | LANDED | CRASHED
const FPM_PER_MPS = 196.85;
const OFF_RUNWAY_CRASH_SPEED = 16;

export class PlayerFlight {
  constructor({ aircraft, effects, sound }) {
    this.aircraft = aircraft;
    this.effects = effects;
    this.sound = sound;
    this.model = new FlightModel();
    this.invertPitch = false;
    this.listeners = { landed: () => {}, crashed: () => {}, message: () => {} };
    this.mission = null;
    this.world = null;
    this.autopilot = new Autopilot(this);
  }

  // P key: engage / disengage the autopilot. Returns the message to show.
  toggleAutopilot() {
    if (this.status !== 'FLYING') return this.status === 'GROUND' ? 'TAKE OFF FIRST, THEN PRESS P FOR AUTOPILOT' : '';
    if (this.autopilot.engaged) { this.autopilot.disengage(); return 'AUTOPILOT OFF'; }
    return this.autopilot.engage().message;
  }

  on(event, fn) { this.listeners[event] = fn; }

  start(world, mission) {
    this.world = world;
    this.mission = mission;
    this.targetId = mission.to;
    this.model.setPerformance(world.performance, world.aircraftScale);
    const label = mission.start === 'final' ? mission.arrive : mission.depart;
    const spawn = spawnFor(world, mission.from, label, mission.start);
    this.model.reset({ ...spawn, position: new THREE.Vector3(spawn.position.x, spawn.position.y, spawn.position.z) });
    this.status = spawn.airborne ? 'FLYING' : 'GROUND';
    this.touchdown = null;
    this.time = 0;
    this.distance = 0;
    this.maxAltitude = 0;
    this.crashReason = null;
    this.autopilot.disengage();
    this.aircraft.root.visible = true;
    this.aircraft.root.scale.setScalar(world.aircraftScale);
    this.effects.clear();
    world.aids.setTarget(this.targetId);
    this.sound.start();
    this.syncAircraft();
  }

  get target() {
    return this.targetId ? this.world.airports.find((a) => a.id === this.targetId) : null;
  }

  airport(id) {
    return this.world.airports.find((a) => a.id === id);
  }

  readControls(input) {
    const k = (code) => input.isDown(code);
    let pitch = (k('KeyS') || k('ArrowDown') ? 1 : 0) - (k('KeyW') || k('ArrowUp') ? 1 : 0);
    if (this.invertPitch) pitch = -pitch;
    return {
      pitch,
      roll: (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0),
      yaw: (k('KeyE') ? 1 : 0) - (k('KeyQ') ? 1 : 0),
      throttle: (k('ShiftLeft') || k('ShiftRight') ? 1 : 0) - (k('KeyZ') ? 1 : 0),
      brake: k('KeyB') || k('Space'),
    };
  }

  update(dt, input) {
    if (!this.mission || this.status === 'CRASHED' || this.status === 'LANDED') {
      this.sound.update(0, 0);
      return;
    }
    let controls = this.readControls(input);
    if (this.autopilot.engaged) {
      // Any flight control input hands the aircraft back to the pilot.
      const manual = controls.pitch || controls.roll || controls.yaw || controls.throttle || controls.brake;
      if (manual) { this.autopilot.disengage(); this.listeners.message('Autopilot disconnected'); } else controls = this.autopilot.controls(dt);
    }
    const before = this.model.position.clone();
    const wasOnGround = this.model.onGround;
    const contact = this.model.update(dt, controls, this.world.heightAt);

    this.time += dt;
    this.distance += before.distanceTo(this.model.position);
    this.maxAltitude = Math.max(this.maxAltitude, this.model.agl);

    if (wasOnGround && !this.model.onGround) {
      this.status = 'FLYING';
      this.touchdown = null;
    }
    if (contact) this.handleContact(contact);
    if (this.model.onGround && this.status !== 'CRASHED') this.checkGroundRoll();
    if (!this.model.onGround && this.status !== 'CRASHED') this.checkHazards();

    this.syncAircraft();
    this.sound.update(this.model.throttle, this.model.speed);
  }

  syncAircraft() {
    const root = this.aircraft.root;
    root.position.copy(this.model.position);
    root.quaternion.copy(this.model.quaternion);
    this.aircraft.setGearExtension(this.model.gearExtension);
    this.aircraft.landingLightOn = this.model.gearDown;
  }

  // Which runway (if any) is under this point, in that runway's local frame (inverse transform).
  runwayAt(x, z, margin = 0) {
    for (const runway of this.world.runways) {
      const local = toRunwayLocal(runway, x, z);
      if (Math.abs(local.x) <= runway.width / 2 + margin && Math.abs(local.z) <= runway.length / 2 + margin) {
        return { runway, airport: this.airport(runway.airport), local };
      }
    }
    return null;
  }

  handleContact(e) {
    const fpm = Math.round(-e.verticalSpeed * FPM_PER_MPS);
    const onRunway = this.runwayAt(e.x, e.z, 1);
    const position = this.model.position;

    if (this.world.isWater(e.x, e.z)) return this.crash('Ditched in the water', fpm);
    if (!e.gearDown) return this.crash('Belly landing: the landing gear was up', fpm);
    if (fpm > 900) return this.crash(`Touchdown far too hard (${fpm} ft/min)`, fpm);
    if (Math.abs(e.bank) > 0.26) return this.crash('A wingtip struck the ground', fpm);
    if (e.pitch < -0.07) return this.crash('Nose-first impact', fpm);
    if (!onRunway) {
      const rough = this.world.slopeAt(position.x, position.z) < 0.93;
      if (e.speed > OFF_RUNWAY_CRASH_SPEED || rough) return this.crash('Crashed into terrain off the runway', fpm);
    }

    this.status = 'ROLLOUT';
    this.effects.touchdown(position, this.model.forward, this.world.aircraftScale);
    if (!onRunway) {
      this.touchdown = { offRunway: true, fpm, airport: null };
      this.listeners.message(`Field landing at ${fpm} ft/min`);
      return;
    }
    const { runway, airport, local } = onRunway;
    const movingTowardMinusZ = Math.cos(this.model.heading - runway.rotation) < 0;
    const fromThreshold = movingTowardMinusZ ? runway.length / 2 - local.z : local.z + runway.length / 2;
    const alignment = radToDeg(Math.min(
      Math.abs(wrapAngle(this.model.heading - runway.rotation)),
      Math.abs(wrapAngle(this.model.heading - runway.rotation - Math.PI)),
    ));
    this.touchdown = {
      airport, runway, runwayLabel: movingTowardMinusZ ? runway.designators[0] : runway.designators[1],
      fpm, centreline: Math.abs(local.x), alignment, fromThreshold,
      speedKt: Math.round(e.speed * 1.944), offRunway: false, byAutopilot: this.autopilot.engaged,
    };
    this.listeners.message(`Touchdown ${fpm} ft/min`);
  }

  checkGroundRoll() {
    const m = this.model;
    const onRunway = this.runwayAt(m.position.x, m.position.z, 3);
    if (!onRunway && m.speed > OFF_RUNWAY_CRASH_SPEED) {
      this.crash(this.status === 'ROLLOUT' ? 'Ran off the runway' : 'Left the runway at high speed');
      return;
    }
    if (this.status === 'ROLLOUT' && m.speed < 1) {
      this.status = 'LANDED';
      this.autopilot.disengage();
      this.sound.stop();
      this.listeners.landed(this.report());
    }
  }

  checkHazards() {
    const p = this.model.position;
    if (p.y <= 1 && this.world.isWater(p.x, p.z)) {
      this.crash('Ditched in the water');
      return;
    }
    if (this.world.obstacleAt && p.y < this.world.obstacleAt(p.x, p.z)) this.crash('Flew into a building');
  }

  crash(reason, fpm = null) {
    this.status = 'CRASHED';
    this.crashReason = reason;
    this.autopilot.disengage();
    this.model.speed = 0;
    this.aircraft.root.visible = false;
    this.effects.explode(this.model.position.clone(), this.world.aircraftScale);
    this.sound.stop();
    this.listeners.crashed({ reason, fpm, time: this.time, distance: this.distance });
  }

  // Landing score out of 100 -> 1..5 stars.
  report() {
    const td = this.touchdown;
    const base = { time: this.time, distance: this.distance, maxAltitude: this.maxAltitude };
    if (!td || td.offRunway) {
      return { ...base, airport: null, stars: 1, score: 20, fpm: td ? td.fpm : 0, verdict: 'Field landing', success: this.targetId === null, rows: [] };
    }
    let score = 100;
    const fpm = Math.max(0, td.fpm);
    score -= fpm > 600 ? 40 : fpm > 400 ? 25 : fpm > 250 ? 12 : fpm > 120 ? 4 : 0;
    const widthScale = td.runway.width / 20;
    score -= Math.min(30, (td.centreline / widthScale) * 4);
    score -= Math.min(20, td.alignment * 2);
    if (td.fromThreshold > td.runway.length * 0.55) score -= 15;
    if (td.fromThreshold < 8) score -= 10;
    score = Math.max(0, Math.round(score));
    const stars = score >= 90 ? 5 : score >= 75 ? 4 : score >= 60 ? 3 : score >= 40 ? 2 : 1;
    const verdict = fpm < 120 ? 'Butter! Perfect touchdown' : fpm < 250 ? 'Smooth landing'
      : fpm < 450 ? 'Firm but safe' : 'Hard landing';
    return {
      ...base, airport: td.airport, runwayLabel: td.runwayLabel, stars, score, fpm, verdict,
      success: this.targetId === null || this.targetId === td.airport.id,
      rows: [
        ['Runway', td.runwayLabel],
        ['Landed by', td.byAutopilot ? 'Autopilot (autoland)' : 'You'],
        ['Touchdown rate', `${fpm} ft/min`],
        ['Centreline offset', `${td.centreline.toFixed(1)} m`],
        ['Runway alignment', `${td.alignment.toFixed(1)}°`],
        ['Touchdown point', `${Math.round(td.fromThreshold)} m past threshold`],
        ['Touchdown speed', `${td.speedKt} kt`],
      ],
    };
  }

  // ---- data for the HUD --------------------------------------------------
  navigation() {
    const target = this.target;
    const p = this.model.position;
    const nearest = this.world.airports.reduce((best, a) => {
      const d = Math.hypot(p.x - a.x, p.z - a.z);
      return !best || d < best.distance ? { airport: a, distance: d } : best;
    }, null);
    if (!target) return { target: null, nearest };
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const distance = Math.hypot(dx, dz);
    const bearing = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360; // compass: 0 = north (-Z)
    const eta = this.model.speed > 5 ? distance / this.model.speed : null;
    return { target, distance, bearing, eta, nearest };
  }

  warnings() {
    const m = this.model;
    const list = [];
    if (this.status !== 'FLYING') return list;
    const scale = this.world.navScale;
    if (m.stalled || m.speed < m.stallSpeed * 1.07) list.push('STALL');
    const timeToImpact = m.verticalSpeed < -1 ? m.agl / -m.verticalSpeed : Infinity;
    if (m.agl < 150 * Math.sqrt(scale) && timeToImpact < 7 && !(m.gearDown && this.runwayAt(m.position.x, m.position.z, 400 * scale))) list.push('PULL UP');
    if (!m.gearDown && m.agl < 200 * Math.sqrt(scale) && m.verticalSpeed < -1) {
      const near = this.world.airports.some((a) => Math.hypot(m.position.x - a.x, m.position.z - a.z) < 2500 * scale);
      if (near) list.push('GEAR');
    }
    return list;
  }

  hint() {
    const m = this.model;
    const scale = this.world.navScale;
    if (this.status === 'GROUND') {
      if (m.throttle < 0.6 && m.speed < m.stallSpeed * 0.7) return 'Hold SHIFT to open the throttle for takeoff';
      if (m.speed > m.stallSpeed * 1.1) return 'ROTATE: hold S (or ↓) to lift the nose';
      return 'Keep straight with A / D';
    }
    if (this.status === 'ROLLOUT') return 'Hold B or SPACE to brake to a stop';
    if (this.status !== 'FLYING') return '';
    if (this.autopilot.engaged) return 'Autopilot flying · touch any flight key to take over';
    if (m.gearDown && m.agl > 60 * Math.sqrt(scale) && m.verticalSpeed > 1 && this.time < 90 * Math.sqrt(scale)) return 'Positive climb: press G to raise the gear';
    const nav = this.navigation();
    if (nav.target && nav.distance < 3000 * scale && !m.gearDown) return 'Approaching: lower the gear (G) and flaps (V)';
    if (nav.target && nav.distance < 2600 * scale) return 'Line up with a runway. PAPI: 2 white + 2 red = on the glide path';
    if (nav.target) return `Press P for autopilot + autoland, or fly to ${nav.target.short} yourself (cyan marker on the compass)`;
    return 'Free flight: land at any airport';
  }
}
