// The pre-filtered sky environment map (made once in main.js), shared by
// everything that reflects the sky: aircraft paint, cockpit glass, water.
let environment = null;
const listeners = [];

export function setSkyEnvironment(texture) {
  environment = texture;
  listeners.forEach((fn) => fn(texture));
}

export function getSkyEnvironment() {
  return environment;
}

export function onSkyEnvironment(fn) {
  listeners.push(fn);
}
