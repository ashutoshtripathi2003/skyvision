import * as THREE from 'three';
import { linear, smoothstep, easeInQuad, easeOutQuad, degToRad } from '../utils/MathUtils.js';

// The whole flight is a list of phases. Each moving phase has a 3D curve
// (straight line, quadratic/cubic Bezier or Catmull-Rom spline) and a
// duration. Every frame the controller converts elapsed time t in [0,1] into
// a distance u along the curve (via an easing function), then reads
//   position = curve.getPointAt(u)    -> translation
//   tangent  = curve.getTangentAt(u)  -> heading (yaw) and climb angle (pitch)
// "hold" phases have no curve: the aircraft simply waits.
//
// World axes: +X east, +Y up, +Z south. North (runway 36) is -Z.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const line = (a, b) => new THREE.LineCurve3(a, b);
const quad = (a, b, c) => new THREE.QuadraticBezierCurve3(a, b, c);
const cubic = (a, b, c, d) => new THREE.CubicBezierCurve3(a, b, c, d);

export const START_POSITION = V(68, 0, 100);
export const START_HEADING = -Math.PI / 2; // facing west (-X), towards the runway

const TAXI_IN = new THREE.CatmullRomCurve3([
  V(0, 0, -80), V(0, 0, -88), V(3, 0, -96), V(12, 0, -100), V(28, 0, -100),
  V(37, 0, -97), V(40, 0, -88), V(40, 0, 0), V(40, 0, 88), V(43, 0, 97),
  V(52, 0, 100), V(70, 0, 100), V(104, 0, 100),
], false, 'centripetal');

// Helper: duration for constant-speed phases = curve length / speed.
const bySpeed = (curve, speed) => curve.getLength() / speed;

export function buildFlightPlan() {
  const phases = [
    { step: 1, label: 'PARKED AT HANGAR', hold: 2 },

    { step: 2, label: 'TAXI TO RUNWAY', curve: line(START_POSITION, V(12, 0, 100)),
      speed: 7, ease: smoothstep, lights: true },

    { step: 3, label: 'ALIGN WITH RUNWAY', curve: quad(V(12, 0, 100), V(0, 0, 100), V(0, 0, 88)),
      speed: 4, ease: smoothstep, lights: true },
    { step: 3, label: 'LINE UP AND WAIT', hold: 2, lights: true },

    // s = 1/2 a t^2  ->  normalised distance = t^2 (constant acceleration)
    { step: 4, label: 'TAKEOFF ROLL', curve: line(V(0, 0, 88), V(0, 0, -40)),
      duration: 8, ease: easeInQuad, lights: true },

    { step: 5, label: 'ROTATE & LIFTOFF',
      curve: cubic(V(0, 0, -40), V(0, 0, -75), V(0, 4, -105), V(0, 14, -145)),
      speed: 32, ease: linear, lights: true,
      extraPitch: (t) => degToRad(5) * Math.sin(Math.PI * t) },

    { step: 6, label: 'CLIMB', curve: line(V(0, 14, -145), V(0, 45, -320)),
      speed: 34, ease: linear, gear: (t) => 1 - smoothstep(Math.min(1, t * 2)) },

    { step: 7, label: 'TURN AROUND',
      curve: cubic(V(0, 45, -320), V(0, 48, -460), V(200, 48, -460), V(200, 45, -320)),
      speed: 38, ease: linear, gear: () => 0 },

    { step: 8, label: 'APPROACH - DOWNWIND', curve: line(V(200, 45, -320), V(200, 40, 200)),
      speed: 42, ease: linear, gear: () => 0 },

    { step: 8, label: 'APPROACH - BASE TURN',
      curve: cubic(V(200, 40, 200), V(200, 38, 360), V(0, 30, 420), V(0, 26, 300)),
      speed: 36, ease: linear, gear: (t) => smoothstep(t), lights: true },

    // The glide path points nose-down ~7 deg; +8 deg extra pitch gives a slightly nose-up attitude.
    { step: 8, label: 'APPROACH - FINAL', curve: line(V(0, 26, 300), V(0, 3, 130)),
      speed: 32, ease: linear, lights: true, extraPitch: () => degToRad(8) },

    { step: 9, label: 'LANDING - FLARE',
      curve: cubic(V(0, 3, 130), V(0, 1.5, 115), V(0, 0.2, 100), V(0, 0, 85)),
      speed: 30, ease: linear, lights: true, extraPitch: (t) => degToRad(8 - 4 * t) },

    { step: 9, label: 'LANDING - ROLLOUT', curve: line(V(0, 0, 85), V(0, 0, -80)),
      duration: 11, ease: easeOutQuad, lights: true,
      extraPitch: (t) => degToRad(4) * (1 - smoothstep(Math.min(1, t * 3))) },

    { step: 10, label: 'TAXI TO HANGAR', curve: TAXI_IN, speed: 11, ease: smoothstep, lights: true },

    { step: 10, label: 'PARKED IN HANGAR', hold: 0.5, final: true },
  ];

  phases.forEach((p) => {
    if (p.hold !== undefined) p.duration = p.hold;
    else if (p.duration === undefined) p.duration = bySpeed(p.curve, p.speed);
    p.extraPitch = p.extraPitch || (() => 0);
    p.gear = p.gear || (() => 1);
  });
  return phases;
}

export const TOTAL_STEPS = 10;
