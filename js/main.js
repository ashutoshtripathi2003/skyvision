import * as THREE from 'three';
import { createRenderer } from './core/Renderer.js';
import { createScene } from './core/Scene.js';
import { ClippingDemo } from './core/ClippingDemo.js';
import { LightingManager } from './lighting/LightingManager.js';
import { CameraManager, CAMERA_MODES, FLIGHT_CAMERA_MODES } from './camera/CameraManager.js';
import { Aircraft } from './aircraft/Aircraft.js';
import { setEnvironment } from './aircraft/ModelLibrary.js';
import { FlightController } from './aircraft/FlightController.js';
import { VehicleManager } from './vehicles/VehicleManager.js';
import { PlayerFlight } from './flight/PlayerFlight.js';
import { Effects } from './flight/Effects.js';
import { EngineSound } from './flight/EngineSound.js';
import { TaxiRouteView } from './flight/TaxiRoute.js';
import { loadMumbaiWorld } from './world/mumbai/MumbaiWorld.js';
import { InputManager } from './input/InputManager.js';
import { TouchControls, IS_TOUCH } from './input/TouchControls.js';
import { Menu } from './ui/Menu.js';
import { HUD } from './ui/HUD.js';
import { FlightHUD } from './ui/FlightHUD.js';

// ---------- Build the application ----------
const canvas = document.getElementById('scene-canvas');
const renderer = createRenderer(canvas, { maxPixelRatio: IS_TOUCH ? 1.5 : 2 });
const { scene, world, skyVision } = createScene();
const lighting = new LightingManager(scene, { shadowMapSize: IS_TOUCH ? 1024 : 2048 });
setEnvironment(createSkyEnvironment(renderer));

// Real-size A320 model (metres); the SkyVision valley is drawn at 1/1.4 of real size.
const VALLEY_SCALE = 1 / 1.4;
const aircraft = new Aircraft({ type: 'a320', livery: 'skyvision', withLights: true });
aircraft.root.scale.setScalar(VALLEY_SCALE);
world.add(aircraft.root);
const demoFlight = new FlightController(aircraft);
const vehicles = new VehicleManager(world);
const effects = new Effects(scene);
const sound = new EngineSound();
const player = new PlayerFlight({ aircraft, effects, sound });
const taxiRoute = new TaxiRouteView(world);

const cameras = new CameraManager(window.innerWidth / window.innerHeight);
const clipping = new ClippingDemo(renderer, scene, world);
const input = new InputManager(canvas);
const hud = new HUD();
const flightHud = new FlightHUD();

const SPEEDS = [0.5, 1, 2, 4];
let speedIndex = 1;
let appMode = 'demo'; // demo | flight
let state = 'menu';   // menu | loading | running | paused | report
let wireframe = false;
let lastFlight = null; // mission object, so RESTART can repeat it
let mumbai = null;     // built the first time a Mumbai mission is chosen
let activeWorld = skyVision;

const menu = new Menu({
  onStartDemo: startDemo,
  onStartMission: (mission) => startFlight(mission),
  onFlyOn: (fromId, toId) => {
    const from = activeWorld.airports.find((a) => a.id === fromId);
    const to = toId ? activeWorld.airports.find((a) => a.id === toId) : null;
    startFlight({
      id: 'onward', world: activeWorld.id, title: to ? `${from.short} to ${to.short}` : `Free flight from ${from.short}`,
      from: fromId, to: toId, start: 'runway',
    });
  },
  onResume: resume,
  onRestart: () => (appMode === 'flight' && lastFlight ? startFlight(lastFlight) : startDemo()),
  onMainMenu: goToMainMenu,
});

player.on('message', (text) => hud.toast(text.toUpperCase()));
player.on('route', (route) => {
  if (route) taxiRoute.show(route, activeWorld.heightAt, 3.2 * Math.sqrt(player.size));
  else taxiRoute.hide();
});
player.on('landed', (report) => {
  touch.setMode('none');
  state = 'report';
  input.enabled = false;
  setTimeout(() => menu.showResults(report, activeWorld.airports), 700);
});
player.on('crashed', (info) => {
  touch.setMode('none');
  state = 'report';
  input.enabled = false;
  setTimeout(() => menu.showCrash(info), 2300);
});

// Only one world is visible at a time; the player's aircraft moves into it.
function activateWorld(target) {
  activeWorld = target;
  world.visible = target === skyVision;
  if (mumbai) mumbai.group.visible = target === mumbai;
  target.group.add(aircraft.root);
  taxiRoute.setParent(target.group);
  scene.fog.near = target.fog.near;
  scene.fog.far = target.fog.far;
  cameras.setFar(target.cameraFar);
}

function enterRunning() {
  state = 'running';
  input.enabled = true;
  menu.hideAll();
}

function startDemo() {
  TouchControls.enterLandscape();
  appMode = 'demo';
  leaveFlight();
  activateWorld(skyVision);
  enterRunning();
  hud.setVisible(true);
  flightHud.setVisible(false);
  touch.setMode('demo');
  demoFlight.reset();
  cameras.useModeSet(CAMERA_MODES, 'AIRPORT');
}

async function startFlight(mission) {
  TouchControls.enterLandscape();
  if (mission.world === 'mumbai' && !mumbai) {
    state = 'loading';
    input.enabled = false;
    menu.showLoading('Loading map data');
    try {
      mumbai = await loadMumbaiWorld((step) => menu.setLoadingStep(step));
      mumbai.group.visible = false;
      scene.add(mumbai.group);
    } catch (err) {
      console.error(err);
      state = 'menu';
      menu.show('missions');
      hud.toast('COULD NOT LOAD MUMBAI DATA');
      return;
    }
  }
  appMode = 'flight';
  lastFlight = mission;
  activateWorld(mission.world === 'mumbai' ? mumbai : skyVision);
  if (mission.world === 'mumbai') mission = { ...mission, aircraftType: menu.aircraftType };
  // Swap in the chosen aircraft and wait (on the loading screen) until its
  // detailed model has loaded and been painted in the airline's colours.
  const type = activeWorld.aircraftTypes ? mission.aircraftType || 'a320' : 'a320';
  if (aircraft.type !== type) aircraft.setType(type, menu.airline);
  else aircraft.applyLivery(menu.airline);
  if (state !== 'loading') { state = 'loading'; input.enabled = false; menu.showLoading('Preparing the aircraft'); }
  else menu.setLoadingStep('Preparing the aircraft');
  await Promise.race([aircraft.modelPromise, new Promise((resolve) => setTimeout(resolve, 20000))]);
  // Compile every shader now (while the loading screen is up) instead of stalling the first frame.
  menu.setLoadingStep('Warming up the graphics');
  try { await renderer.compileAsync(scene, cameras.camera); } catch { /* not supported: compiled on first use */ }
  enterRunning();
  hud.setVisible(false);
  flightHud.setVisible(true);
  touch.setMode('flight');
  if (!FLIGHT_CAMERA_MODES.includes(cameras.mode)) cameras.useModeSet(FLIGHT_CAMERA_MODES, 'CHASE');
  else cameras.setMode(cameras.mode);
  player.start(activeWorld, mission);
}

function leaveFlight() {
  player.mission = null;
  sound.stop();
  effects.clear();
  activeWorld.aids.setTarget(null);
  lighting.setShadowFocus(null);
  taxiRoute.hide();
  aircraft.root.visible = true;
  if (aircraft.type !== 'a320') aircraft.setType('a320');
  aircraft.root.scale.setScalar(VALLEY_SCALE);
  aircraft.applyLivery('skyvision');
}

function pause() {
  touch.setMode('none');
  state = 'paused';
  input.enabled = false;
  sound.stop();
  document.getElementById('btn-restart').classList.toggle('hidden', appMode !== 'flight');
  menu.show('pause');
}

function resume() {
  touch.setMode(appMode === 'flight' ? 'flight' : 'demo');
  enterRunning();
  if (appMode === 'flight') sound.start();
}

function goToMainMenu() {
  touch.setMode('none');
  state = 'menu';
  input.enabled = false;
  hud.setVisible(false);
  flightHud.setVisible(false);
  leaveFlight();
  appMode = 'demo';
  activateWorld(skyVision);
  demoFlight.reset();
  cameras.useModeSet(CAMERA_MODES, 'MENU');
  menu.show('menu');
}

// ---------- Actions (shared by the keyboard and the on-screen touch buttons) ----------
input.enabled = false;
const inFlight = () => appMode === 'flight';

const actions = {
  demoToggle() {
    if (inFlight()) return;
    demoFlight.toggle();
    hud.toast(`FLIGHT ${demoFlight.status}`);
  },
  camera() { cameras.cycle(); hud.toast(`CAMERA: ${cameras.mode}`); },
  night() { lighting.toggleDayNight(); hud.toast(lighting.isNight ? 'NIGHT MODE' : 'DAY MODE'); },
  reset() {
    if (inFlight()) { startFlight(lastFlight); hud.toast('FLIGHT RESTARTED'); return; }
    demoFlight.reset();
    hud.toast('AIRCRAFT RESET');
  },
  gear() {
    if (!inFlight()) return;
    player.model.toggleGear();
    hud.toast(player.model.gearDown ? 'GEAR DOWN' : 'GEAR UP');
  },
  flaps() {
    if (!inFlight()) return;
    const m = player.model;
    m.cycleFlaps(m.flaps === 2 ? -2 : 1);
    hud.toast(`FLAPS ${['UP', '1', 'FULL'][m.flaps]}`);
  },
  autopilot() {
    if (!inFlight()) return;
    const message = player.toggleAutopilot();
    if (message) hud.toast(message);
  },
  pause() {
    if (menu.controlsOpen) menu.show(menu.returnTo);
    else if (state === 'running') pause();
    else if (state === 'paused') resume();
  },
};
const touch = new TouchControls(actions);

input.onKey('Space', actions.demoToggle); // in Fly Yourself SPACE is the wheel brake (read as a held key)
input.onKey('KeyC', actions.camera);
[0, 1, 2, 3, 4].forEach((i) => input.onKey(`Digit${i + 1}`, () => {
  cameras.selectIndex(i);
  hud.toast(`CAMERA: ${cameras.mode}`);
}));
input.onKey('KeyN', actions.night);
input.onKey('KeyR', actions.reset);
input.onKey('KeyG', actions.gear);
input.onKey('KeyV', actions.flaps);
input.onKey('KeyP', actions.autopilot);
input.onKey('KeyI', () => {
  if (!inFlight()) return;
  player.invertPitch = !player.invertPitch;
  hud.toast(player.invertPitch ? 'PITCH INVERTED: W = NOSE UP' : 'PITCH NORMAL: S = NOSE UP');
});
input.onKey('KeyT', () => {
  if (!inFlight()) return;
  player.model.assist = !player.model.assist;
  hud.toast(player.model.assist ? 'FLIGHT ASSIST ON' : 'FLIGHT ASSIST OFF: FULL AEROBATICS');
});
input.onKey('KeyM', () => hud.toast(sound.toggleMute() ? 'SOUND MUTED' : 'SOUND ON'));
input.onKey('KeyK', () => {
  if (activeWorld !== skyVision) { hud.toast('CLIPPING DEMO: SKYVISION WORLD ONLY'); return; }
  clipping.toggle();
  hud.toast(clipping.enabled ? 'CLIPPING PLANE ON' : 'CLIPPING PLANE OFF');
});
input.onKey('KeyF', toggleWireframe);
input.onKey('KeyH', () => {
  if (inFlight()) { flightHud.toggleUserHidden(); flightHud.setVisible(true); } else hud.toggleUserHidden();
});
input.onKey('KeyO', saveScreenshot);
['Equal', 'NumpadAdd'].forEach((code) => input.onKey(code, () => changeSpeed(1)));
['Minus', 'NumpadSubtract'].forEach((code) => input.onKey(code, () => changeSpeed(-1)));
input.onKey('Escape', actions.pause);
input.onWheel((delta) => cameras.zoom(delta));

function changeSpeed(direction) {
  if (inFlight()) return;
  speedIndex = Math.max(0, Math.min(SPEEDS.length - 1, speedIndex + direction));
  hud.toast(`ANIMATION SPEED ${SPEEDS[speedIndex]}x`);
}

function toggleWireframe() {
  wireframe = !wireframe;
  scene.traverse((o) => {
    if (!o.isMesh) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      if (m.isMeshStandardMaterial) m.wireframe = wireframe;
    });
  });
  hud.toast(wireframe ? 'WIREFRAME ON' : 'WIREFRAME OFF');
}

function saveScreenshot() {
  renderer.render(scene, cameras.camera); // read back in the same task, before the buffer is cleared
  const link = document.createElement('a');
  link.href = renderer.domElement.toDataURL('image/png');
  link.download = `skyvision-${Date.now()}.png`;
  link.click();
  hud.toast('SCREENSHOT SAVED');
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  cameras.setAspect(window.innerWidth / window.innerHeight);
  flightHud.resize();
});

// ---------- Main loop ----------
const clock = new THREE.Clock();
cameras.useModeSet(CAMERA_MODES, 'MENU');
menu.show('menu');

function nearestTowerEye() {
  const p = aircraft.root.position;
  const nearest = activeWorld.airports.reduce((best, a) => (
    !best || Math.hypot(p.x - a.x, p.z - a.z) < Math.hypot(p.x - best.x, p.z - best.z) ? a : best
  ), null);
  return nearest.towerEye;
}

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.05); // clamp so a stalled tab doesn't teleport objects
  const elapsed = clock.elapsedTime;
  const paused = state === 'paused' || state === 'loading';

  if (appMode === 'flight') {
    if (!paused) player.update(dt, input, touch.enabled && state === 'running' ? touch.controls : null);
    touch.update(player);
    lighting.setShadowFocus(aircraft.root.position);
  } else if (state === 'running') {
    demoFlight.update(dt * SPEEDS[speedIndex]);
  }
  if (!paused) {
    if (activeWorld === skyVision) vehicles.update(appMode === 'demo' ? dt * SPEEDS[speedIndex] : dt, elapsed, lighting.night);
    effects.update(dt);
    taxiRoute.update(dt);
  }
  lighting.update(dt, elapsed);
  activeWorld.aids.update(aircraft.root.position, lighting.night);
  aircraft.updateLights(elapsed, lighting.night);
  cameras.update(dt, input, aircraft, {
    towerEye: nearestTowerEye(), shake: effects.shake, scale: appMode === 'flight' ? player.size : 1,
  });
  if (activeWorld.update) activeWorld.update(dt, cameras.camera.position);
  clipping.update(elapsed);
  lighting.sky.follow(cameras.camera);

  if (state !== 'menu' && state !== 'loading') {
    if (appMode === 'flight') {
      flightHud.update({ flight: player, camera: cameras.mode, night: lighting.isNight, muted: sound.muted, touch: IS_TOUCH });
    } else {
      hud.update({
        camera: cameras.mode, night: lighting.isNight, flight: demoFlight,
        simSpeed: SPEEDS[speedIndex], clipping: clipping.enabled, touch: IS_TOUCH,
      });
    }
  }

  renderer.render(scene, cameras.camera);
}

frame();

// Reflections: a small blurred copy of a sky gradient (PMREM = pre-filtered
// environment map), used by the aircraft paint and cockpit glass.
function createSkyEnvironment(webglRenderer) {
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(100, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 p; void main() { p = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 p;
      void main() {
        float h = normalize(p).y;
        vec3 sky = mix(vec3(0.85, 0.9, 0.95), vec3(0.35, 0.55, 0.85), pow(max(h, 0.0), 0.6));
        vec3 ground = mix(vec3(0.5, 0.52, 0.48), vec3(0.28, 0.3, 0.28), pow(max(-h, 0.0), 0.5));
        gl_FragColor = vec4(h > 0.0 ? sky : ground, 1.0);
      }`,
  })));
  const pmrem = new THREE.PMREMGenerator(webglRenderer);
  const texture = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();
  return texture;
}
