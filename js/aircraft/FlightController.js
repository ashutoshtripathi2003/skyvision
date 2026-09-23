import * as THREE from 'three';
import { buildFlightPlan, START_POSITION, START_HEADING, TOTAL_STEPS } from './FlightPath.js';
import { clamp, damp, wrapAngle, degToRad } from '../utils/MathUtils.js';

const GRAVITY = 9.81;
const MAX_BANK = degToRad(25);

// Runs the flight plan and writes the aircraft's transformation each frame:
//   root.position   = point on the curve              (translation)
//   root.rotation.y = heading from the curve tangent  (yaw)
//   root.rotation.x = climb angle + extra pitch       (pitch)
//   root.rotation.z = bank angle from turn rate       (roll)
export class FlightController {
  constructor(aircraft) {
    this.aircraft = aircraft;
    this.phases = buildFlightPlan();
    this.tangent = new THREE.Vector3();
    this.lastPosition = new THREE.Vector3();
    this.reset();
  }

  reset() {
    this.index = 0;
    this.phaseTime = 0;
    this.status = 'READY'; // READY | RUNNING | PAUSED | COMPLETE
    this.heading = START_HEADING;
    this.pitch = 0;
    this.bank = 0;
    this.speed = 0;

    const root = this.aircraft.root;
    root.position.copy(START_POSITION);
    root.rotation.set(0, START_HEADING, 0);
    this.lastPosition.copy(START_POSITION);
    this.aircraft.setGearExtension(1);
    this.aircraft.landingLightOn = false;
  }

  // SPACE: start / pause / resume / restart
  toggle() {
    if (this.status === 'READY') this.status = 'RUNNING';
    else if (this.status === 'RUNNING') this.status = 'PAUSED';
    else if (this.status === 'PAUSED') this.status = 'RUNNING';
    else if (this.status === 'COMPLETE') { this.reset(); this.status = 'RUNNING'; }
  }

  get phase() {
    return this.phases[this.index];
  }

  get phaseLabel() {
    if (this.status === 'READY') return 'READY AT HANGAR';
    return this.phase.label;
  }

  get stepText() {
    return `${this.phase.step}/${TOTAL_STEPS}`;
  }

  update(dt) {
    if (this.status !== 'RUNNING' || dt <= 0) return;

    this.phaseTime += dt;
    while (this.phaseTime >= this.phase.duration) {
      if (this.phase.final) {
        this.phaseTime = this.phase.duration;
        this.status = 'COMPLETE';
        break;
      }
      this.phaseTime -= this.phase.duration;
      this.index++;
    }

    const phase = this.phase;
    const t = clamp(this.phaseTime / phase.duration, 0, 1);
    this.aircraft.landingLightOn = !!phase.lights;
    this.aircraft.setGearExtension(phase.gear(t));

    if (phase.curve) this.applyCurvePose(phase, t, dt);
    else this.speed = 0;
  }

  applyCurvePose(phase, t, dt) {
    const root = this.aircraft.root;
    const u = phase.ease(t);

    phase.curve.getPointAt(u, root.position);
    phase.curve.getTangentAt(u, this.tangent);

    // Heading (yaw): angle of the tangent in the ground plane. The model's nose is +Z,
    // so atan2(x, z) is the rotation about Y that turns +Z onto the tangent direction.
    const newHeading = Math.atan2(this.tangent.x, this.tangent.z);
    const yawRate = wrapAngle(newHeading - this.heading) / dt;
    this.heading = newHeading;

    // Pitch: climb angle of the tangent plus the phase's extra nose-up attitude.
    const climb = Math.asin(clamp(this.tangent.y, -1, 1));
    this.pitch = damp(this.pitch, climb + phase.extraPitch(t), 6, dt);

    // Speed from how far we moved this frame.
    this.speed = root.position.distanceTo(this.lastPosition) / dt;
    this.lastPosition.copy(root.position);

    // Bank for a coordinated turn: tan(bank) = v * turnRate / g. Only when airborne.
    const airborne = root.position.y > 1;
    const targetBank = airborne ? clamp(Math.atan((this.speed * -yawRate) / GRAVITY), -MAX_BANK, MAX_BANK) : 0;
    this.bank = damp(this.bank, targetBank, 3, dt);

    root.rotation.set(-this.pitch, this.heading, this.bank); // nose-up is negative X rotation
  }

  // Compass heading in degrees (0 = north = -Z, 90 = east = +X).
  get compassHeading() {
    const deg = 180 - (this.heading * 180) / Math.PI;
    return ((deg % 360) + 360) % 360;
  }
}
