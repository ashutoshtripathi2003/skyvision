import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Night-time "bloom": bright lights (runway and taxiway lamps, strobes, lit
// windows, the city) bleed a soft glow into their surroundings, as they do in a
// real camera or eye. Post-processing pipeline:
//   1. render the scene into an off-screen HDR image (half-float, 4x MSAA)
//   2. bloom: keep only pixels brighter than a threshold, blur them at several
//      sizes and add them back on top
//   3. output: tone mapping + sRGB conversion to the screen
// During the day (and on phones, to save battery) the scene is drawn directly.
export class PostFX {
  constructor(renderer, scene, camera, { enabled = true } = {}) {
    this.renderer = renderer;
    this.enabled = enabled;
    if (!enabled) return;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.8, 0.45, 0.82);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  setSize(width, height) {
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(width, height);
    }
  }

  // night: 0 (day) .. 1 (night)
  render(scene, camera, night) {
    if (!this.enabled || night < 0.12) {
      this.renderer.render(scene, camera);
      return;
    }
    this.renderPass.scene = scene;
    this.renderPass.camera = camera;
    this.bloom.strength = 0.25 + 0.65 * night;
    this.composer.render();
  }
}
