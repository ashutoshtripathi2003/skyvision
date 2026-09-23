// Data for every airfield in the world, shared by the terrain (to flatten the
// ground under each one), the airfield builder and the flight/landing logic.
//
// Each runway is modelled in its own local frame (runway along local Z) and
// placed in the world with one translation (x, y, z) + one rotation about Y.
export const AIRFIELDS = [
  {
    id: 'SKV', name: 'SkyVision International', short: 'SkyVision',
    x: 0, y: 0, z: -80, rotation: 0, length: 400, width: 20,
    flatInner: 700, flatOuter: 1300, home: true,
  },
  {
    id: 'LKV', name: 'Lakeview Regional', short: 'Lakeview',
    x: 2600, y: 4, z: -3400, rotation: -Math.PI / 2, length: 420, width: 24,
    flatInner: 480, flatOuter: 950,
  },
  {
    id: 'SMT', name: 'Summit Airstrip', short: 'Summit',
    x: -3000, y: 300, z: -3900, rotation: 0.66, length: 320, width: 18,
    flatInner: 360, flatOuter: 760,
  },
];

export const airfieldById = (id) => AIRFIELDS.find((a) => a.id === id);

// Runway numbers: heading of the runway's local -Z direction in compass degrees / 10.
export function runwayDesignators(field) {
  const compass = (((-field.rotation * 180) / Math.PI) % 360 + 360) % 360;
  const near = Math.round(compass / 10) || 36;
  const far = ((near + 18 - 1) % 36) + 1;
  const fmt = (n) => String(n).padStart(2, '0');
  return [fmt(near), fmt(far)];
}

// Inverse transformation: world point -> runway-local coordinates.
// The runway group is R_y(rotation) then translated, so we translate back and
// rotate by the transpose (inverse) of R_y.
export function toRunwayLocal(field, x, z) {
  const dx = x - field.x;
  const dz = z - field.z;
  const c = Math.cos(field.rotation);
  const s = Math.sin(field.rotation);
  return { x: c * dx - s * dz, z: s * dx + c * dz };
}

// Runway-local -> world (forward transformation), used for spawn points.
export function fromRunwayLocal(field, lx, lz) {
  const c = Math.cos(field.rotation);
  const s = Math.sin(field.rotation);
  return { x: field.x + c * lx + s * lz, z: field.z - s * lx + c * lz };
}
