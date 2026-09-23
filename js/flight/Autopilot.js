import { fromRunwayLocal, toRunwayLocal } from '../world/AirfieldData.js';
import { clamp, wrapAngle } from '../utils/MathUtils.js';

// Autopilot with automatic landing. It produces the same control inputs a
// player would (pitch / roll / yaw / throttle / brake), so it flies the same
// flight model through simple proportional controllers:
//
//   heading  -> bank:   targetBank  = k * (heading - desiredHeading)
//   altitude -> pitch:  climb angle = asin(desiredVerticalSpeed / speed)
//   speed    -> power:  throttle rate = k * (targetSpeed - speed)
//
// Phases (with a destination):
//   CLIMB/CRUISE -> fly to the intercept point on the runway's extended centreline
//   APPROACH     -> track the centreline and the glide path (like an ILS)
//   FLARE        -> ease the descent a few metres above the runway, close the throttle
//   ROLLOUT      -> brake and steer along the centreline until stopped
// Without a destination it simply holds the current heading, altitude and speed.

export class Autopilot {
  constructor(flight) {
    this.flight = flight;
    this.engaged = false;
    this.phase = 'OFF';
  }

  get model() { return this.flight.model; }
  get world() { return this.flight.world; }

  // Returns a message for the HUD; refuses on the ground.
  engage() {
    const m = this.model;
    if (m.onGround || m.agl < 20 * this.world.aircraftScale) return { ok: false, message: 'TAKE OFF FIRST, THEN PRESS P FOR AUTOPILOT' };
    this.engaged = true;
    this.hold = { heading: m.heading, altitude: Math.max(m.position.y, this.world.heightAt(m.position.x, m.position.z) + 150), speed: Math.max(m.speed, m.stallSpeed * 1.4) };
    const target = this.flight.target;
    if (target) {
      this.plan = this.planApproach(target);
      this.cruiseAltitude = this.safeCruiseAltitude(this.plan.intercept);
      this.phase = 'CRUISE';
      return { ok: true, message: `AUTOPILOT ON · LANDING ${target.short.toUpperCase()} RWY ${this.plan.label}` };
    }
    this.plan = null;
    this.phase = 'HOLD';
    return { ok: true, message: 'AUTOPILOT ON · HOLDING HEADING AND ALTITUDE' };
  }

  disengage() {
    this.engaged = false;
    this.phase = 'OFF';
  }

  // Choose the runway end that needs the least turning: for every end, the
  // intercept point lies out on the extended centreline; cost = distance to it
  // plus a penalty for the turn needed to join the final approach course.
  planApproach(airport) {
    const m = this.model;
    const faf = this.world.finalDistance;          // final approach fix distance
    const interceptDistance = faf * 1.8;
    let best = null;
    this.world.runways.filter((r) => r.airport === airport.id).forEach((runway) => {
      [1, -1].forEach((sign) => {
        const course = runway.rotation + (sign > 0 ? Math.PI : 0);
        const ip = fromRunwayLocal(runway, 0, sign * (runway.length / 2 + interceptDistance));
        const toIp = Math.atan2(ip.x - m.position.x, ip.z - m.position.z);
        const turn = Math.abs(wrapAngle(toIp - course));
        const cost = Math.hypot(ip.x - m.position.x, ip.z - m.position.z) + turn * faf;
        if (!best || cost < best.cost) {
          best = {
            cost, runway, sign, course, intercept: ip, interceptDistance,
            label: sign > 0 ? runway.designators[0] : runway.designators[1],
          };
        }
      });
    });
    return best;
  }

  // Cruise high enough to clear terrain (and buildings) along the straight path.
  safeCruiseAltitude(to) {
    const w = this.world;
    const p = this.model.position;
    const steps = Math.ceil(Math.hypot(to.x - p.x, to.z - p.z) / 250);
    let highest = 0;
    for (let i = 0; i <= steps; i++) {
      const x = p.x + ((to.x - p.x) * i) / steps;
      const z = p.z + ((to.z - p.z) * i) / steps;
      highest = Math.max(highest, w.heightAt(x, z), w.obstacleAt ? w.obstacleAt(x, z) : 0);
    }
    const margin = 180 * Math.sqrt(w.navScale);
    return Math.max(highest + margin, 300 * Math.sqrt(w.navScale));
  }

  // Runway-local position along the approach: along > 0 is distance out from the runway centre.
  approachGeometry() {
    const { runway, sign } = this.plan;
    const p = this.model.position;
    const local = toRunwayLocal(runway, p.x, p.z);
    return { along: sign * local.z, lateral: sign * local.x, runway };
  }

  controls(dt) {
    const m = this.model;
    const perf = m.perf;
    const scale = this.world.aircraftScale;
    let desiredHeading;
    let targetAltitude;
    let targetSpeed;
    let flare = false;
    let brake = false;

    // Automatic configuration after takeoff.
    if (m.gearDown && m.verticalSpeed > 1 && m.agl > 60 * scale && this.phase !== 'APPROACH' && this.phase !== 'FLARE') m.gearDown = false;

    if (this.phase === 'HOLD') {
      desiredHeading = this.hold.heading;
      targetAltitude = this.hold.altitude;
      targetSpeed = this.hold.speed;
      if (m.flaps > 0 && m.speed > perf.stallSpeed[0] * 1.3) m.flaps = 0;
    } else {
      const glide = (this.world.glideSlope * Math.PI) / 180;
      const { along, lateral, runway } = this.approachGeometry();
      const aimOffset = 300 * (scale / 1.4) * Math.min(1, runway.length / 2000); // aim point past the threshold
      const toAim = along - runway.length / 2 + aimOffset;
      const glideAltitude = runway.y + Math.max(0, toAim) * Math.tan(glide);

      if (this.phase === 'CRUISE') {
        const ip = this.plan.intercept;
        const dist = Math.hypot(ip.x - m.position.x, ip.z - m.position.z);
        desiredHeading = Math.atan2(ip.x - m.position.x, ip.z - m.position.z);
        const ipAltitude = runway.y + (this.plan.interceptDistance + aimOffset) * Math.tan(glide);
        // Continuous descent: never higher than a 3.5 deg path down to the intercept point.
        targetAltitude = Math.max(ipAltitude, Math.min(this.cruiseAltitude, ipAltitude + dist * Math.tan((3.5 * Math.PI) / 180)));
        targetSpeed = dist > 6000 * Math.sqrt(this.world.navScale / 4) ? perf.stallSpeed[0] * 1.75 : perf.stallSpeed[1] * 1.35;
        if (m.flaps > 0 && targetSpeed > perf.stallSpeed[0] * 1.5 && m.speed > perf.stallSpeed[0] * 1.3) m.flaps = 0;
        const onCourse = Math.abs(wrapAngle(m.heading - this.plan.course)) < 0.6 && Math.abs(lateral) < 1500 * scale;
        // Capture the approach near the intercept point, or earlier if already established on the
        // extended centreline - but only on the approach side of the runway (along > half length).
        const onApproachSide = along > runway.length / 2 && along < this.plan.interceptDistance + runway.length / 2 + 500;
        // ...and only once high enough to join the glide path (otherwise keep climbing / holding near the fix).
        const highEnough = m.position.y > glideAltitude - 40 * Math.sqrt(this.world.navScale);
        if (highEnough && (dist < 1200 * Math.sqrt(this.world.navScale) || (onCourse && onApproachSide))) {
          this.phase = 'APPROACH';
        }
      }

      if (this.phase === 'APPROACH' || this.phase === 'FLARE' || this.phase === 'ROLLOUT') {
        // Localizer: steer back towards the centreline (intercept angle limited to ~30 deg).
        const gain = 1 / (250 * Math.sqrt(this.world.navScale));
        desiredHeading = this.plan.course + clamp(lateral * gain, -0.5, 0.5);
        targetAltitude = glideAltitude;
        targetSpeed = perf.stallSpeed[2] * 1.3;
        m.gearDown = true;
        m.flaps = toAim < this.world.finalDistance ? 2 : Math.max(m.flaps, 1);
        if (!m.onGround && m.agl < 10 * scale && along < runway.length / 2 + 400 * scale) { this.phase = 'FLARE'; flare = true; }
        if (m.onGround) { this.phase = 'ROLLOUT'; brake = true; targetSpeed = 0; }
      }
    }

    // --- heading -> bank (or nose-wheel steering on the ground)
    const headingError = wrapAngle(m.heading - desiredHeading);
    const maxBank = 0.44; // 25 deg
    let roll;
    if (m.onGround) {
      roll = clamp(headingError * 3, -1, 1);
    } else {
      const targetBank = clamp(headingError * 1.6, -maxBank, maxBank);
      roll = clamp((targetBank - m.bank) * 3, -1, 1);
    }

    // --- altitude -> climb angle -> pitch
    let pitch = 0;
    if (!m.onGround) {
      const maxClimb = 6 * Math.sqrt(this.world.navScale);
      let desiredVs = clamp((targetAltitude - m.position.y) / 10, -maxClimb, maxClimb);
      if (this.phase === 'APPROACH') {
        const glideVs = -m.speed * Math.tan((this.world.glideSlope * Math.PI) / 180);
        desiredVs = glideVs + clamp((targetAltitude - m.position.y) / 6, -3, 3);
      }
      if (flare) desiredVs = -Math.max(0.6, m.agl * 0.2); // round out: sink ever more slowly
      const targetPitch = Math.asin(clamp(desiredVs / Math.max(m.speed, 1), -0.25, 0.25))
        + (m.speed < m.stallSpeed * 1.25 ? 0.02 : 0);
      pitch = clamp((targetPitch - m.pitch) * 6, -1, 1);
    }

    // --- speed -> throttle
    let throttle = clamp((targetSpeed - m.speed) * 0.25, -1, 1);
    if (flare && m.agl < 1.5 * scale) throttle = -1; // power off just before the wheels touch
    if (m.onGround) throttle = -1;

    return { pitch, roll, yaw: 0, throttle, brake };
  }

  status() {
    if (!this.engaged) return '';
    const m = this.model;
    const kt = Math.round(m.speed * 1.944);
    if (this.phase === 'HOLD') return `AUTOPILOT · HOLD · ${Math.round(this.hold.altitude)} m · ${kt} kt`;
    const label = `RWY ${this.plan.label}`;
    if (this.phase === 'CRUISE') return `AUTOPILOT · NAV TO ${this.flight.target.id} ${label} · ${Math.round(this.cruiseAltitude)} m · ${kt} kt`;
    if (this.phase === 'APPROACH') return `AUTOPILOT · APPROACH ${label} · GLIDE PATH · ${kt} kt`;
    if (this.phase === 'FLARE') return `AUTOLAND · FLARE ${label}`;
    return `AUTOLAND · ROLLOUT ${label} · BRAKING`;
  }
}
