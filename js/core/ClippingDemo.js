import * as THREE from 'three';

// Clipping demonstration (key K). A vertical clipping plane sweeps across the
// airport; every fragment on the far side of the plane is discarded by the GPU.
//
// Plane equation: n . p + d = 0 with n = (-1, 0, 0), d = x0
//   distance(p) = x0 - p.x  -> points with p.x > x0 are clipped away.
// The sky and stars are not in `world`, so they are never clipped.
export class ClippingDemo {
  constructor(renderer, scene, world) {
    this.renderer = renderer;
    this.world = world;
    this.enabled = false;
    this.plane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
    renderer.localClippingEnabled = true;

    // Translucent red sheet showing where the plane is.
    this.marker = new THREE.Mesh(
      new THREE.PlaneGeometry(700, 160),
      new THREE.MeshBasicMaterial({
        color: 0xff3b3b, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    this.marker.rotation.y = Math.PI / 2;
    this.marker.visible = false;
    scene.add(this.marker);
  }

  toggle() {
    this.enabled = !this.enabled;
    this.marker.visible = this.enabled;
    const planes = this.enabled ? [this.plane] : null;
    this.world.traverse((object) => {
      if (!object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((m) => {
        m.clippingPlanes = planes;
        m.clipShadows = true;
        m.needsUpdate = true;
      });
    });
  }

  update(elapsed) {
    if (!this.enabled) return;
    const x0 = 70 + Math.sin(elapsed * 0.35) * 75;
    this.plane.constant = x0;
    this.marker.position.set(x0 - 0.05, 60, 0);
  }
}
