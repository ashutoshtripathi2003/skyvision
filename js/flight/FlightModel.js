import * as THREE from 'three';
import { clamp, damp } from '../utils/MathUtils.js';

// A simplified (arcade) flight model that is still physically motivated:
//
//   speed      : dV/dt = thrust*throttle - k*V^2*(1 + flap/gear drag) - g*sin(pitch) [- braking]
//   lift       : the aircraft flies where its nose points while V > stall speed;
//                below it (or in steep banks) lift is lost and it sinks: lift ~ (V/Vs)^2 * cos(bank)
//   turning    : banking turns the aircraft (coordinated turn): turn rate = g * tan(bank) / V
//   controls   : pitch / roll / yaw are small rotations about the aircraft's OWN axes,
//                applied with quaternions (no gimbal lock, loops and rolls work)
//
// Aircraft local axes: nose +Z, left wing +X, up +Y (same as Aircraft.js).

const G = 9.81;
// Trainer-scale jet used in the SkyVision valley (short runways, gentle speeds).
export const TRAINER = {
  thrust: 5.4,              // m/s^2 at full throttle
  drag: 0.00076,            // per (m/s)^2 -> top speed ~84 m/s clean
  stallSpeed: [27, 24, 21], // m/s for flaps 0 / 1 / 2
  flapDrag: [0, 0.35, 0.8],
  gearDrag: 0.25,
  pitchRate: 0.45,          // rad/s at full stick (keyboard-friendly)
  rollRate: 1.4,
  yawRate: 0.35,
  steerRate: 0.8,           // nose-wheel steering on the ground
  brakeDecel: 6.5,
  rollingFriction: 0.3,
  gearTransit: 3,           // seconds to raise/lower the gear
  maxGroundPitch: 0.24,     // ~14 deg before the tail would strike
};

// A320-class airliner at real scale, used over Mumbai (rotate ~135 kt, approach ~130 kt, cruise ~290 kt).
export const AIRLINER = {
  thrust: 3.0,
  drag: 0.00013,
  stallSpeed: [66, 58, 52],
  flapDrag: [0, 0.35, 0.9],
  gearDrag: 0.25,
  pitchRate: 0.3,
  rollRate: 0.95,
  yawRate: 0.2,
  steerRate: 0.45,
  brakeDecel: 3.2,
  rollingFriction: 0.25,
  gearTransit: 6,
  maxGroundPitch: 0.21,
};

const LOCAL_X = new THREE.Vector3(1, 0, 0);
const LOCAL_Y = new THREE.Vector3(0, 1, 0);
const LOCAL_Z = new THREE.Vector3(0, 0, 1);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export class FlightModel {
  constructor() {
    this.position = new THREE.Vector3();
    this.quaternion = new THREE.Quaternion();
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.forward = new THREE.Vector3(0, 0, 1);
    this.velocity = new THREE.Vector3();
    this.stick = { pitch: 0, roll: 0, yaw: 0 };
    this.q = new THREE.Quaternion();
    this.assist = true;
    this.setPerformance(TRAINER, 1);
    this.reset({ position: new THREE.Vector3(), heading: 0 });
  }

  reset({ position, heading, speed = 0, airborne = false, throttle = 0, flaps = 0, gearDown = true, pitch = 0 }) {
    this.position.copy(position);
    this.speed = speed;
    this.throttle = throttle;
    this.flaps = flaps;
    this.gearDown = gearDown;
    this.gearExtension = gearDown ? 1 : 0;
    this.onGround = !airborne;
    this.groundPitch = 0;
    this.sink = 0;
    this.verticalSpeed = 0;
    this.agl = 0;
    this.brake = false;
    this.stick = { pitch: 0, roll: 0, yaw: 0 };
    this.quaternion.setFromEuler(new THREE.Euler(-pitch, heading, 0, 'YXZ'));
    this.updateAttitude();
  }

  // Performance profile + visual scale of the aircraft (the belly height scales with it).
  setPerformance(perf, scale = 1) {
    this.perf = perf;
    this.bellyHeight = 1.4 * scale;
  }

  get stallSpeed() {
    return this.perf.stallSpeed[this.flaps];
  }

  get stalled() {
    return !this.onGround && this.speed < this.stallSpeed;
  }

  // Heading / pitch / bank extracted from the orientation quaternion (Euler order YXZ).
  updateAttitude() {
    this.euler.setFromQuaternion(this.quaternion, 'YXZ');
    this.heading = this.euler.y;
    this.pitch = -this.euler.x; // nose-up is a negative rotation about X in our model frame
    this.bank = this.euler.z;
    this.forward.copy(LOCAL_Z).applyQuaternion(this.quaternion);
  }

  toggleGear() { this.gearDown = !this.gearDown; }

  cycleFlaps(direction = 1) { this.flaps = clamp(this.flaps + direction, 0, 2); }

  // Rotate about one of the aircraft's own axes: q = q * rotation(axis, angle).
  rotateLocal(axis, angle) {
    this.q.setFromAxisAngle(axis, angle);
    this.quaternion.multiply(this.q);
  }

  // controls: pitch (+1 nose up), roll (+1 right), yaw (+1 right), throttle (-1..1 rate), brake (bool)
  // groundHeight(x, z) -> terrain height; returns a contact event on the frame the aircraft touches down.
  update(dt, controls, groundHeight) {
    const P = this.perf;
    this.stick.pitch = damp(this.stick.pitch, controls.pitch, 7, dt);
    this.stick.roll = damp(this.stick.roll, controls.roll, 7, dt);
    this.stick.yaw = damp(this.stick.yaw, controls.yaw, 5, dt);
    this.throttle = clamp(this.throttle + controls.throttle * 0.55 * dt, 0, 1);
    this.brake = controls.brake;
    const gearStep = dt / P.gearTransit;
    this.gearExtension = clamp(this.gearExtension + (this.gearDown ? gearStep : -gearStep), 0, 1);

    const lastY = this.position.y;
    const ground = groundHeight(this.position.x, this.position.z);
    let event = null;

    // ---- speed along the flight path ----
    const dragFactor = 1 + P.flapDrag[this.flaps] + P.gearDrag * this.gearExtension;
    // Gravity along the flight path (climbing slows you, diving speeds you up) only
    // applies in the air - on the runway, raising the nose doesn't mean climbing yet.
    const gravityAlongPath = this.onGround ? 0 : G * this.forward.y;
    let accel = P.thrust * this.throttle - P.drag * dragFactor * this.speed * this.speed - gravityAlongPath;
    if (this.onGround && this.speed > 0) {
      accel -= P.rollingFriction + (this.brake ? P.brakeDecel : 0);
    }
    this.speed = Math.max(0, this.speed + accel * dt);
    const authority = clamp(this.speed / this.stallSpeed, 0.12, 1.15); // controls are weak when slow

    if (this.onGround) {
      this.updateGround(dt, authority, ground);
    } else {
      this.updateAir(dt, authority);
      const contactHeight = ground + (this.gearExtension > 0.95 ? 0 : this.bellyHeight); // belly sits above the wheels
      if (this.position.y <= contactHeight) {
        event = {
          verticalSpeed: (this.position.y - lastY) / dt,
          pitch: this.pitch, bank: this.bank, speed: this.speed,
          gearDown: this.gearExtension > 0.95, x: this.position.x, z: this.position.z,
        };
        this.position.y = ground;
        this.onGround = true;
        this.groundPitch = clamp(this.pitch, 0, P.maxGroundPitch);
        this.sink = 0;
      }
    }

    this.verticalSpeed = (this.position.y - lastY) / dt;
    this.agl = this.position.y - groundHeight(this.position.x, this.position.z);
    this.updateAttitude();
    return event;
  }

  updateAir(dt, authority) {
    const P = this.perf;

    // Stick inputs rotate the aircraft about its own axes.
    this.rotateLocal(LOCAL_X, -this.stick.pitch * P.pitchRate * authority * dt);
    this.rotateLocal(LOCAL_Z, this.stick.roll * P.rollRate * authority * dt);
    this.rotateLocal(LOCAL_Y, -this.stick.yaw * P.yawRate * authority * dt);
    this.updateAttitude();

    // Gentle roll stability: with the stick centred the wings slowly level.
    if (Math.abs(this.stick.roll) < 0.05 && Math.abs(this.bank) < 1.2) {
      this.rotateLocal(LOCAL_Z, -this.bank * 0.5 * dt);
    }

    // Flight assist (key T): soft limits that keep a keyboard pilot out of trouble.
    if (this.assist) {
      const pitchLimit = this.speed < this.stallSpeed * 1.15 ? 0.05 : 0.21; // ~12 deg, less when slow
      if (this.pitch > pitchLimit) this.rotateLocal(LOCAL_X, (this.pitch - pitchLimit) * 4 * dt);
      if (this.pitch < -0.26) this.rotateLocal(LOCAL_X, (this.pitch + 0.26) * 4 * dt);
      if (Math.abs(this.bank) > 0.78) this.rotateLocal(LOCAL_Z, -(this.bank - Math.sign(this.bank) * 0.78) * 6 * dt);
    }

    // Coordinated turn: bank angle turns the heading about the WORLD up axis.
    const bank = clamp(this.bank, -1.3, 1.3);
    const turnRate = (-G * Math.tan(bank)) / Math.max(this.speed, 15) * Math.cos(this.pitch);
    this.q.setFromAxisAngle(WORLD_UP, turnRate * dt);
    this.quaternion.premultiply(this.q);

    // Stall: the nose drops by itself (to about 12 deg down) until airspeed recovers.
    if (this.speed < this.stallSpeed && this.pitch > -0.2) {
      const severity = 1 - this.speed / this.stallSpeed;
      this.rotateLocal(LOCAL_X, (0.2 + severity) * 0.6 * dt);
    }
    this.quaternion.normalize();
    this.updateAttitude();

    // Lift vs. weight: lift ~ V^2 (reduced by bank). Below ~1.25x stall speed it no
    // longer holds the aircraft up and it starts to sink, so slowing down descends.
    const liftRatio = (this.speed / (1.25 * this.stallSpeed)) ** 2 * Math.max(Math.cos(this.bank), 0);
    const sinkTarget = Math.max(0, 1 - liftRatio) * 10;
    this.sink = damp(this.sink, sinkTarget, 1.6, dt);

    this.velocity.copy(this.forward).multiplyScalar(this.speed);
    this.velocity.y -= this.sink;
    this.position.addScaledVector(this.velocity, dt); // translation
  }

  updateGround(dt, authority, ground) {
    const P = this.perf;
    // Nose-wheel steering (roll or rudder input), stronger at taxi speed.
    const steer = clamp(this.stick.roll + this.stick.yaw, -1, 1);
    const heading = this.heading - steer * P.steerRate * Math.min(1, this.speed / 6) * dt;

    // Rotation for takeoff: the nose can only come up once there is enough airflow.
    const canRotate = this.speed > this.stallSpeed * 0.85;
    const pitchInput = canRotate ? this.stick.pitch : Math.min(0, this.stick.pitch);
    this.groundPitch = clamp(this.groundPitch + pitchInput * P.pitchRate * 0.6 * authority * dt, 0, P.maxGroundPitch);
    if (!canRotate) this.groundPitch = damp(this.groundPitch, 0, 3, dt);

    this.quaternion.setFromEuler(new THREE.Euler(-this.groundPitch, heading, 0, 'YXZ'));
    this.position.x += Math.sin(heading) * this.speed * dt;
    this.position.z += Math.cos(heading) * this.speed * dt;
    this.position.y = ground;

    // Liftoff when the nose is up and there is enough speed to climb away.
    if (this.groundPitch > 0.05 && this.speed > this.stallSpeed * 1.2) {
      this.onGround = false;
      this.position.y = ground + 0.05;
    }
  }
}
