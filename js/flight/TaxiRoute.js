import * as THREE from 'three';

// The green "follow-me" line painted along the planned taxi route. It is a flat
// ribbon (two vertices per route point, offset sideways along the normal) with
// a chevron texture; scrolling the texture offset every frame animates the
// arrows towards the stand (texture animation - no geometry changes).

function chevronTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(40,255,120,0.35)';
  ctx.fillRect(0, 0, 64, 64);
  ctx.strokeStyle = 'rgba(190,255,210,0.95)';
  ctx.lineWidth = 9;
  ctx.lineCap = 'round';
  ctx.beginPath(); // arrow pointing along +u (the direction of travel)
  ctx.moveTo(18, 10);
  ctx.lineTo(44, 32);
  ctx.lineTo(18, 54);
  ctx.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class TaxiRouteView {
  constructor(parent) {
    this.texture = chevronTexture();
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
    // Red stop bar across the stand's lead-in line: stop with the nose wheel on it.
    this.stopBar = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0.9, depthWrite: false, fog: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    );
    this.stopBar.rotation.order = 'YXZ';
    this.stopBar.visible = false;
    parent.add(this.stopBar);
  }

  setParent(parent) {
    if (this.mesh.parent !== parent) parent.add(this.mesh, this.stopBar);
  }

  // route: [[x, z], ...]; heightAt(x, z) gives the ground height; width in metres.
  show(route, heightAt, width = 3, noseOffset = 0) {
    const positions = [];
    const uvs = [];
    const indices = [];
    let along = 0;
    for (let i = 0; i < route.length; i++) {
      const [x, z] = route[i];
      const [ax, az] = route[Math.max(0, i - 1)];
      const [bx, bz] = route[Math.min(route.length - 1, i + 1)];
      const len = Math.hypot(bx - ax, bz - az) || 1;
      const nx = -(bz - az) / len; // sideways normal of the path direction
      const nz = (bx - ax) / len;
      if (i > 0) along += Math.hypot(x - route[i - 1][0], z - route[i - 1][1]);
      const y = heightAt(x, z) + 0.25;
      positions.push(x + nx * width / 2, y, z + nz * width / 2, x - nx * width / 2, y, z - nz * width / 2);
      const u = along / (width * 2); // one chevron every two widths
      uvs.push(u, 1, u, 0);
      if (i > 0) {
        const a = (i - 1) * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(indices);
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
    this.material.side = THREE.DoubleSide;
    this.mesh.visible = true;

    // Stop bar: at the last point, across the direction of travel, and 'noseOffset' ahead
    // of it (the route ends where the main gear stops; the bar marks the nose wheel).
    const [ex, ez] = route[route.length - 1];
    const [px, pz] = route[route.length - 2] || route[0];
    const heading = Math.atan2(ex - px, ez - pz);
    const ahead = noseOffset;
    const bx = ex + Math.sin(heading) * ahead;
    const bz = ez + Math.cos(heading) * ahead;
    this.stopBar.position.set(bx, heightAt(bx, bz) + 0.3, bz);
    this.stopBar.rotation.set(-Math.PI / 2, 0, 0);
    this.stopBar.rotation.y = heading;
    this.stopBar.scale.set(width * 3, width * 0.35, 1);
    this.stopBar.visible = true;
  }

  hide() {
    this.mesh.visible = false;
    this.stopBar.visible = false;
  }

  update(dt) {
    if (this.mesh.visible) this.texture.offset.x -= dt * 1.2; // arrows flow towards the stand
  }
}
