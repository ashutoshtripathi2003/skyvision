import * as THREE from 'three';
import { clamp, damp } from '../utils/MathUtils.js';
import { TOWER } from '../airport/Tower.js';

// Two sets of camera modes share one PerspectiveCamera and one OrthographicCamera.
//
// Autopilot demo:
//   TOP     - OrthographicCamera straight down (parallel projection, no perspective)
//   AIRPORT - fixed cinematic PerspectiveCamera over the runway and terminal
//   FOLLOW  - chase camera behind the aircraft
//   TOWER   - from the control tower cab, always looking at the aircraft
//   FREE    - fly anywhere with W/A/S/D/Q/E + mouse drag
// Fly Yourself:
//   CHASE   - behind the aircraft, horizon kept level
//   COCKPIT - pilot's eye, rotates with the aircraft (full quaternion)
//   ORBIT   - drag the mouse to circle the aircraft, wheel to zoom
//   TOWER   - nearest airfield's tower, tracking and zooming on the aircraft
//   MAP     - orthographic top-down map centred on the aircraft
// MENU is an internal slow orbit used behind the main menu.
export const CAMERA_MODES = ['TOP', 'AIRPORT', 'FOLLOW', 'TOWER', 'FREE'];
export const FLIGHT_CAMERA_MODES = ['CHASE', 'COCKPIT', 'ORBIT', 'TOWER', 'MAP'];

const TOP_VIEW_HALF_HEIGHT = 190;
const MAP_VIEW_HALF_HEIGHT = 650;
const TOP_CENTER = new THREE.Vector3(70, 0, 0);
const AIRPORT_VIEW = { position: new THREE.Vector3(-65, 32, 185), target: new THREE.Vector3(55, 0, -10) };
const FOLLOW_OFFSET = new THREE.Vector3(0, 7, -32); // behind (-Z) and above the aircraft, in its local frame
const CHASE_OFFSET = new THREE.Vector3(0, 6, -27);
const HOME_TOWER_EYE = new THREE.Vector3(TOWER.x - 3, TOWER.cabHeight + 0.5, TOWER.z);
const FREE_SPEED = 40;
const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

export class CameraManager {
  constructor(aspect) {
    // Perspective projection: fov, aspect, near and far clipping planes.
    this.perspective = new THREE.PerspectiveCamera(55, aspect, 0.3, 14000);

    // Orthographic projection: a box-shaped view volume (left/right/top/bottom/near/far).
    this.orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 4000);
    this.orthographic.up.set(0, 0, -1); // north (-Z) at the top of the screen

    this.modes = CAMERA_MODES;
    this.mode = 'AIRPORT';
    this.followDistance = 1;
    this.free = { yaw: 0, pitch: 0 };
    this.orbit = { yaw: Math.PI, pitch: 0.25, distance: 45 };
    this.menuAngle = 0;
    this.lookTarget = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.tmp2 = new THREE.Vector3();
    this.towerEye = HOME_TOWER_EYE.clone();
    this.aspect = aspect;

    this.setAspect(aspect);
    this.setMode('AIRPORT');
  }

  get camera() {
    return this.mode === 'TOP' || this.mode === 'MAP' ? this.orthographic : this.perspective;
  }

  useModeSet(modes, initial) {
    this.modes = modes;
    this.setMode(initial);
  }

  // Far clipping plane: the Mumbai region needs a much deeper view volume than the valley.
  setFar(far) {
    this.perspective.far = far;
    this.perspective.updateProjectionMatrix();
  }

  setAspect(aspect) {
    this.aspect = aspect;
    this.perspective.aspect = aspect;
    this.perspective.updateProjectionMatrix();
    const h = this.mode === 'MAP' ? MAP_VIEW_HALF_HEIGHT : TOP_VIEW_HALF_HEIGHT;
    Object.assign(this.orthographic, { left: -h * aspect, right: h * aspect, top: h, bottom: -h });
    this.orthographic.updateProjectionMatrix();
  }

  cycle() {
    const next = (this.modes.indexOf(this.mode) + 1) % this.modes.length;
    this.setMode(this.modes[next]);
  }

  selectIndex(i) {
    if (i < this.modes.length) this.setMode(this.modes[i]);
  }

  setMode(mode) {
    const previous = this.mode;
    this.mode = mode;
    const cam = this.perspective;
    if (mode === 'TOP' || mode === 'MAP') {
      this.orthographic.zoom = 1;
      this.setAspect(this.aspect);
      if (mode === 'TOP') {
        this.orthographic.position.set(TOP_CENTER.x, 600, TOP_CENTER.z);
        this.orthographic.lookAt(TOP_CENTER);
      }
    } else if (mode === 'AIRPORT') {
      cam.position.copy(AIRPORT_VIEW.position);
      cam.lookAt(AIRPORT_VIEW.target);
    } else if (mode === 'FREE' && previous !== 'FREE') {
      // Start free-flying from wherever the perspective camera currently is.
      if (previous === 'TOP') cam.position.set(TOP_CENTER.x, 120, TOP_CENTER.z + 150);
      const dir = cam.getWorldDirection(this.tmp);
      this.free.yaw = Math.atan2(-dir.x, -dir.z);
      this.free.pitch = Math.asin(clamp(dir.y, -1, 1));
    }
    this.snap = true;
  }

  // Mouse wheel: zoom the ortho views or change the chase / orbit distance.
  zoom(delta) {
    const out = delta > 0;
    if (this.mode === 'TOP' || this.mode === 'MAP') {
      this.orthographic.zoom = clamp(this.orthographic.zoom * (out ? 0.9 : 1.1), 0.3, 6);
      this.orthographic.updateProjectionMatrix();
    } else if (this.mode === 'FOLLOW' || this.mode === 'CHASE') {
      this.followDistance = clamp(this.followDistance * (out ? 1.1 : 0.9), 0.4, 3);
    } else if (this.mode === 'ORBIT') {
      this.orbit.distance = clamp(this.orbit.distance * (out ? 1.1 : 0.9), 15, 400);
    }
  }

  // context: { towerEye } - the tower to use in flight TOWER mode; shake: 0..1 camera shake
  update(dt, input, aircraft, context = {}) {
    const cam = this.perspective;
    const plane = aircraft.root;
    const smooth = this.snap ? 1 : 1 - Math.exp(-5 * dt);
    const scale = context.scale || 1; // aircraft size: camera offsets grow with it
    this.snap = false;

    switch (this.mode) {
      case 'MENU': {
        this.menuAngle += dt * 0.06;
        cam.position.set(60 + Math.cos(this.menuAngle) * 260, 85, Math.sin(this.menuAngle) * 260);
        cam.lookAt(60, 0, 0);
        break;
      }
      case 'FOLLOW': {
        // Viewing transformation built from the aircraft's own coordinate frame:
        // rotate the local offset by the aircraft's heading (yaw only, so the view
        // doesn't roll with the wings), then translate it to the aircraft's position.
        const desired = this.tmp.copy(FOLLOW_OFFSET).multiplyScalar(this.followDistance)
          .applyAxisAngle(THREE.Object3D.DEFAULT_UP, plane.rotation.y)
          .add(plane.position);
        cam.position.lerp(desired, smooth === 1 ? 1 : 1 - Math.exp(-4 * dt));
        this.lookTarget.copy(plane.position).y += 3;
        cam.lookAt(this.lookTarget);
        break;
      }
      case 'CHASE': {
        const heading = headingOf(plane.quaternion);
        const desired = this.tmp.copy(CHASE_OFFSET).multiplyScalar(this.followDistance * scale)
          .applyAxisAngle(THREE.Object3D.DEFAULT_UP, heading)
          .add(plane.position);
        cam.position.lerp(desired, smooth);
        const forward = this.tmp2.set(0, 0, 1).applyQuaternion(plane.quaternion);
        this.lookTarget.copy(plane.position).addScaledVector(forward, 20 * scale).y += 2.5 * scale;
        cam.up.set(0, 1, 0);
        cam.lookAt(this.lookTarget);
        break;
      }
      case 'COCKPIT': {
        // Camera rigidly attached to the aircraft: eye point transformed from
        // aircraft space to world space, orientation = aircraft orientation
        // turned 180 deg (a camera looks down its -Z, the aircraft's nose is +Z).
        // The eye point comes from the aircraft type (A380 pilots sit much higher).
        cam.position.copy(aircraft.cockpitEye).multiply(plane.scale).applyQuaternion(plane.quaternion).add(plane.position);
        cam.quaternion.copy(plane.quaternion).multiply(FLIP);
        break;
      }
      case 'ORBIT': {
        const { dx, dy } = input.consumeMouseDelta();
        this.orbit.yaw -= dx * 0.006;
        this.orbit.pitch = clamp(this.orbit.pitch + dy * 0.005, -0.2, 1.4);
        const { yaw, pitch } = this.orbit;
        const distance = this.orbit.distance * scale;
        // Spherical -> Cartesian coordinates around the aircraft.
        cam.position.set(
          plane.position.x + distance * Math.cos(pitch) * Math.sin(yaw),
          plane.position.y + 3 + distance * Math.sin(pitch),
          plane.position.z + distance * Math.cos(pitch) * Math.cos(yaw),
        );
        cam.up.set(0, 1, 0);
        cam.lookAt(plane.position.x, plane.position.y + 3, plane.position.z);
        break;
      }
      case 'TOWER': {
        const eye = context.towerEye || HOME_TOWER_EYE;
        if (!eye.equals(this.towerEye)) { this.towerEye.copy(eye); this.lookTarget.copy(plane.position); }
        this.lookTarget.lerp(plane.position, 1 - Math.exp(-6 * dt));
        cam.position.copy(this.towerEye);
        cam.up.set(0, 1, 0);
        cam.lookAt(this.lookTarget);
        cam.fov = damp(cam.fov, clamp(55 * 120 / (this.towerEye.distanceTo(plane.position) + 1), 4, 55), 3, dt);
        cam.updateProjectionMatrix();
        break;
      }
      case 'MAP': {
        this.orthographic.position.set(plane.position.x, plane.position.y + 1500, plane.position.z);
        this.orthographic.lookAt(plane.position);
        break;
      }
      case 'FREE':
        this.updateFree(dt, input);
        break;
      default:
        break;
    }
    if (this.mode !== 'TOWER' && cam.fov !== 55) {
      cam.fov = 55;
      cam.updateProjectionMatrix();
    }
    if (context.shake > 0 && this.camera === cam) {
      const s = context.shake * 1.2;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
    }
  }

  updateFree(dt, input) {
    const cam = this.perspective;
    const { dx, dy } = input.consumeMouseDelta();
    this.free.yaw -= dx * 0.004;
    this.free.pitch = clamp(this.free.pitch - dy * 0.004, -1.45, 1.45);

    const speed = FREE_SPEED * (input.isDown('ShiftLeft') || input.isDown('ShiftRight') ? 3 : 1) * dt;
    const forward = new THREE.Vector3(-Math.sin(this.free.yaw), 0, -Math.cos(this.free.yaw));
    const right = new THREE.Vector3(-forward.z, 0, forward.x);
    if (input.isDown('KeyW')) cam.position.addScaledVector(forward, speed);
    if (input.isDown('KeyS')) cam.position.addScaledVector(forward, -speed);
    if (input.isDown('KeyD')) cam.position.addScaledVector(right, speed);
    if (input.isDown('KeyA')) cam.position.addScaledVector(right, -speed);
    if (input.isDown('KeyE')) cam.position.y += speed;
    if (input.isDown('KeyQ')) cam.position.y -= speed;
    cam.position.y = Math.max(2, cam.position.y);

    cam.rotation.set(this.free.pitch, this.free.yaw, 0, 'YXZ');
  }
}

const EULER = new THREE.Euler();
function headingOf(quaternion) {
  return EULER.setFromQuaternion(quaternion, 'YXZ').y;
}
