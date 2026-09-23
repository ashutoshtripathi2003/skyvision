// Small math helpers shared by the animation, camera and lighting modules.

export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const degToRad = (d) => (d * Math.PI) / 180;
export const radToDeg = (r) => (r * 180) / Math.PI;

// Easing curves map normalised time t in [0,1] to normalised distance in [0,1].
export const linear = (t) => t;
export const smoothstep = (t) => t * t * (3 - 2 * t);   // starts and ends at rest
export const easeInQuad = (t) => t * t;                 // constant acceleration: s = 1/2 a t^2
export const easeOutQuad = (t) => 1 - (1 - t) * (1 - t); // constant deceleration

// Frame-rate independent exponential smoothing towards a target.
export function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

// Wraps an angle difference into (-PI, PI] so turning always takes the short way.
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

// Deterministic pseudo-random generator so trees/cars land in the same place every run.
export function seededRandom(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
