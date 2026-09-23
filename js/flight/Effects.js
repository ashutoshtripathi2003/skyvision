import * as THREE from 'three';
import { glowTexture } from '../utils/Textures.js';

// Simple particle system built from a pool of sprites. Each particle has a
// position, velocity, age and lifetime; every frame it is translated by its
// velocity, scaled up and faded out (opacity) as it ages.

const POOL_SIZE = 160;

export class Effects {
  constructor(scene) {
    this.particles = [];
    this.shake = 0;
    this.flash = new THREE.PointLight(0xffa040, 0, 400, 1.5);
    scene.add(this.flash);

    for (let i = 0; i < POOL_SIZE; i++) {
      const material = new THREE.SpriteMaterial({
        map: glowTexture(), transparent: true, opacity: 0, depthWrite: false,
      });
      const sprite = new THREE.Sprite(material);
      sprite.visible = false;
      scene.add(sprite);
      this.particles.push({ sprite, velocity: new THREE.Vector3(), age: 0, life: 0, grow: 0, fade: 1, drag: 0 });
    }
  }

  spawn(position, { velocity, life, size, grow, color, additive, opacity, drag = 0.4 }) {
    const p = this.particles.find((q) => !q.sprite.visible) || this.particles[0];
    p.sprite.position.copy(position);
    p.sprite.scale.setScalar(size);
    p.sprite.material.color.set(color);
    p.sprite.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    p.sprite.material.opacity = opacity;
    p.sprite.visible = true;
    p.velocity.copy(velocity);
    p.age = 0;
    p.life = life;
    p.grow = grow;
    p.fade = opacity;
    p.drag = drag;
  }

  // Puffs of tyre smoke at the main wheels on touchdown.
  touchdown(position, forward, scale = 1) {
    for (let i = 0; i < 12; i++) {
      const side = (i % 2 ? 1.9 : -1.9) * scale;
      const pos = position.clone().add(new THREE.Vector3(forward.z * side, 0.4, -forward.x * side));
      this.spawn(pos, {
        velocity: new THREE.Vector3((Math.random() - 0.5) * 2, 0.6 + Math.random(), (Math.random() - 0.5) * 2),
        life: 1.4 + Math.random() * 0.6, size: 1.5 * scale, grow: 3.5 * scale, color: 0xdedede, additive: false, opacity: 0.55,
      });
    }
  }

  // Fireball + debris sparks + rising smoke.
  explode(position, scale = 1) {
    this.shake = 1.4;
    this.flash.position.copy(position).y += 4;
    this.flash.intensity = 60000;
    for (let i = 0; i < 50; i++) {
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9, Math.random() - 0.5).normalize();
      this.spawn(position.clone().addScaledVector(dir, 2), {
        velocity: dir.multiplyScalar(8 + Math.random() * 22), life: 0.9 + Math.random() * 0.8,
        size: (5 + Math.random() * 6) * scale, grow: 10 * scale, color: i % 3 ? 0xff7a1a : 0xffd27a, additive: true, opacity: 1, drag: 1.6,
      });
    }
    for (let i = 0; i < 45; i++) {
      const pos = position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 10, 2 + Math.random() * 4, (Math.random() - 0.5) * 10));
      this.spawn(pos, {
        velocity: new THREE.Vector3((Math.random() - 0.5) * 3, 5 + Math.random() * 6, (Math.random() - 0.5) * 3),
        life: 3.5 + Math.random() * 3, size: 8 * scale, grow: 9 * scale, color: 0x2b2b2b, additive: false, opacity: 0.7, drag: 0.3,
      });
    }
  }

  clear() {
    this.particles.forEach((p) => { p.sprite.visible = false; });
    this.flash.intensity = 0;
    this.shake = 0;
  }

  update(dt) {
    this.flash.intensity *= Math.exp(-5 * dt);
    this.shake = Math.max(0, this.shake - dt * 1.2);
    this.particles.forEach((p) => {
      if (!p.sprite.visible) return;
      p.age += dt;
      if (p.age >= p.life) { p.sprite.visible = false; return; }
      const t = p.age / p.life;
      p.velocity.multiplyScalar(Math.exp(-p.drag * dt));
      p.sprite.position.addScaledVector(p.velocity, dt);
      p.sprite.scale.addScalar(p.grow * dt);
      p.sprite.material.opacity = p.fade * (1 - t);
    });
  }
}
