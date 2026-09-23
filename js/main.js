import * as THREE from 'three';
import { createRenderer } from './core/Renderer.js';
import { createScene } from './core/Scene.js';
import { ClippingDemo } from './core/ClippingDemo.js';
import { LightingManager } from './lighting/LightingManager.js';
import { CameraManager, CAMERA_MODES, FLIGHT_CAMERA_MODES } from './camera/CameraManager.js';
import { Aircraft } from './aircraft/Aircraft.js';
import { FlightController } from './aircraft/FlightController.js';
import { VehicleManager } from './vehicles/VehicleManager.js';
import { PlayerFlight } from './flight/PlayerFlight.js';
import { Effects } from './flight/Effects.js';
import { EngineSound } from './flight/EngineSound.js';
import { loadMumbaiWorld } from './world/mumbai/MumbaiWorld.js';
import { InputManager } from './input/InputManager.js';
import { Menu } from './ui/Menu.js';
import { HUD } from './ui/HUD.js';
import { FlightHUD } from './ui/FlightHUD.js';

// ---------- Build the application ----------
const canvas = document.getElementById('scene-canvas');
const renderer = createRenderer(canvas);
const { scene, world, skyVision } = createScene();
const lighting = new LightingManager(scene);

const aircraft = new Aircraft({ livery: 'skyvision', withLights: true });
world.add(aircraft.root);
const demoFlight = new FlightController(aircraft);
const vehicles = new VehicleManager(world);
const effects = new Effects(scene);
const sound = new EngineSound();
const player = new PlayerFlight({ aircraft, effects, sound });

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
player.on('landed', (report) => {
  state = 'report';
  input.enabled = false;
  setTimeout(() => menu.showResults(report, activeWorld.airports), 700);
});
player.on('crashed', (info) => {
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
  appMode = 'demo';
  leaveFlight();
  activateWorld(skyVision);
  enterRunning();
  hud.setVisible(true);
  flightHud.setVisible(false);
  demoFlight.reset();
  cameras.useModeSet(CAMERA_MODES, 'AIRPORT');
}

async function startFlight(mission) {
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
  aircraft.applyLivery(menu.airline);
  enterRunning();
  hud.setVisible(false);
  flightHud.setVisible(true);
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
  aircraft.root.visible = true;
  aircraft.root.scale.setScalar(1);
  aircraft.applyLivery('skyvision');
}

function pause() {
  state = 'paused';
  input.enabled = false;
  sound.stop();
  document.getElementById('btn-restart').classList.toggle('hidden', appMode !== 'flight');
  menu.show('pause');
}

function resume() {
  enterRunning();
  if (appMode === 'flight') sound.start();
}

function goToMainMenu() {
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

// ---------- Keyboard bindings ----------
input.enabled = false;
const inFlight = () => appMode === 'flight';

input.onKey('Space', () => {
  if (inFlight()) return; // SPACE is the wheel brake in Fly Yourself (read as a held key)
  demoFlight.toggle();
  hud.toast(`FLIGHT ${demoFlight.status}`);
});
input.onKey('KeyC', () => { cameras.cycle(); hud.toast(`CAMERA: ${cameras.mode}`); });
[0, 1, 2, 3, 4].forEach((i) => input.onKey(`Digit${i + 1}`, () => {
  cameras.selectIndex(i);
  hud.toast(`CAMERA: ${cameras.mode}`);
}));
input.onKey('KeyN', () => { lighting.toggleDayNight(); hud.toast(lighting.isNight ? 'NIGHT MODE' : 'DAY MODE'); });
input.onKey('KeyR', () => {
  if (inFlight()) { startFlight(lastFlight); hud.toast('FLIGHT RESTARTED'); return; }
  demoFlight.reset();
  hud.toast('AIRCRAFT RESET');
});
input.onKey('KeyG', () => {
  if (!inFlight()) return;
  player.model.toggleGear();
  hud.toast(player.model.gearDown ? 'GEAR DOWN' : 'GEAR UP');
});
input.onKey('KeyV', () => {
  if (!inFlight()) return;
  const m = player.model;
  m.cycleFlaps(m.flaps === 2 ? -2 : 1);
  hud.toast(`FLAPS ${['UP', '1', 'FULL'][m.flaps]}`);
});
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
input.onKey('KeyP', () => {
  if (!inFlight()) return;
  const message = player.toggleAutopilot();
  if (message) hud.toast(message);
});
['Equal', 'NumpadAdd'].forEach((code) => input.onKey(code, () => changeSpeed(1)));
['Minus', 'NumpadSubtract'].forEach((code) => input.onKey(code, () => changeSpeed(-1)));
input.onKey('Escape', () => {
  if (menu.controlsOpen) menu.show(menu.returnTo);
  else if (state === 'running') pause();
  else if (state === 'paused') resume();
});
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
    if (!paused) player.update(dt, input);
    lighting.setShadowFocus(aircraft.root.position);
  } else if (state === 'running') {
    demoFlight.update(dt * SPEEDS[speedIndex]);
  }
  if (!paused) {
    if (activeWorld === skyVision) vehicles.update(appMode === 'demo' ? dt * SPEEDS[speedIndex] : dt, elapsed, lighting.night);
    effects.update(dt);
  }
  lighting.update(dt, elapsed);
  activeWorld.aids.update(aircraft.root.position, lighting.night);
  aircraft.updateLights(elapsed, lighting.night);
  cameras.update(dt, input, aircraft, {
    towerEye: nearestTowerEye(), shake: effects.shake, scale: appMode === 'flight' ? activeWorld.aircraftScale : 1,
  });
  clipping.update(elapsed);
  lighting.sky.follow(cameras.camera);

  if (state !== 'menu' && state !== 'loading') {
    if (appMode === 'flight') {
      flightHud.update({ flight: player, camera: cameras.mode, night: lighting.isNight, muted: sound.muted });
    } else {
      hud.update({
        camera: cameras.mode, night: lighting.isNight, flight: demoFlight,
        simSpeed: SPEEDS[speedIndex], clipping: clipping.enabled,
      });
    }
  }

  renderer.render(scene, cameras.camera);
}

frame();
