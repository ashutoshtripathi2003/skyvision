// Minimal AC3D (.ac) reader, used by convert-aircraft.mjs.
//
// AC3D is a text format: a list of MATERIALs, then a tree of OBJECTs. Each
// object has an optional local transform (rot = 3x3 matrix, loc = translation),
// its own vertices, and SURFaces (polygons) that index those vertices with
// per-corner texture coordinates. Child objects are transformed by all their
// parents: world = parent * (rot * v + loc).
//
// readAC(text) -> { materials, meshes } where each mesh is one object with
// world-space triangles: { name, path (names of all ancestors), texture,
// positions[], uvs[], materials[] (one per triangle), smooth, twoSided }.

export function readAC(text) {
  const lines = text.split(/\r?\n/);
  let i = 0;
  const next = () => lines[i++];
  const materials = [];
  const meshes = [];

  const header = next();
  if (!header.startsWith('AC3D')) throw new Error('not an AC3D file');

  const num = (s) => parseFloat(s);
  const identity = () => [1, 0, 0, 0, 1, 0, 0, 0, 1];

  function readObject(parentRot, parentLoc, path) {
    // current line is "OBJECT <type>"
    const type = lines[i - 1].trim().split(/\s+/)[1];
    let name = '';
    let texture = null;
    let texrep = [1, 1];
    let texoff = [0, 0];
    let rot = identity();
    let loc = [0, 0, 0];
    let verts = [];
    const surfs = [];
    let kids = 0;
    for (;;) {
      const raw = next();
      if (raw === undefined) break;
      const line = raw.trim();
      if (!line) continue;
      const [key, ...rest] = line.split(/\s+/);
      if (key === 'name') name = line.slice(5).replace(/^"|"$/g, '');
      else if (key === 'data') { const n = parseInt(rest[0], 10); let got = 0; while (got < n) { got += next().length + 1; } }
      else if (key === 'texture') texture = line.slice(8).replace(/^"|"$/g, '');
      else if (key === 'texrep') texrep = [num(rest[0]), num(rest[1])];
      else if (key === 'texoff') texoff = [num(rest[0]), num(rest[1])];
      else if (key === 'rot') rot = rest.slice(0, 9).map(num);
      else if (key === 'loc') loc = rest.slice(0, 3).map(num);
      else if (key === 'numvert') {
        const n = parseInt(rest[0], 10);
        verts = new Array(n);
        for (let k = 0; k < n; k++) verts[k] = next().trim().split(/\s+/).map(num);
      } else if (key === 'numsurf') {
        const n = parseInt(rest[0], 10);
        for (let s = 0; s < n; s++) {
          let flags = 0; let mat = 0; let refs = [];
          for (;;) {
            const l = next().trim();
            if (!l) continue;
            const [k2, ...r2] = l.split(/\s+/);
            if (k2 === 'SURF') flags = parseInt(r2[0], 16);
            else if (k2 === 'mat') mat = parseInt(r2[0], 10);
            else if (k2 === 'refs') {
              const m = parseInt(r2[0], 10);
              refs = [];
              for (let q = 0; q < m; q++) {
                const p = next().trim().split(/\s+/);
                refs.push([parseInt(p[0], 10), num(p[1] || 0), num(p[2] || 0)]);
              }
              break;
            }
          }
          surfs.push({ flags, mat, refs });
        }
      } else if (key === 'kids') { kids = parseInt(rest[0], 10); break; }
    }

    // World transform of this object: R = parentRot * rot, L = parentRot * loc + parentLoc.
    const mul = (a, b) => [
      a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
      a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
      a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
    ];
    const apply = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
    // AC3D stores rot row-major as it is applied to row vectors; treat it as the matrix applied to column vectors transposed.
    const rotT = [rot[0], rot[3], rot[6], rot[1], rot[4], rot[7], rot[2], rot[5], rot[8]];
    const R = mul(parentRot, rotT);
    const pl = apply(parentRot, loc);
    const L = [pl[0] + parentLoc[0], pl[1] + parentLoc[1], pl[2] + parentLoc[2]];
    const myPath = type === 'world' ? path : [...path, name];

    if (surfs.length) {
      const world = verts.map((v) => { const r = apply(R, v); return [r[0] + L[0], r[1] + L[1], r[2] + L[2]]; });
      const positions = [];
      const uvs = [];
      const mats = [];
      let smooth = false;
      let twoSided = false;
      surfs.forEach((s) => {
        const kind = s.flags & 0x0f;
        if (kind !== 0 || s.refs.length < 3) return; // lines are skipped
        if (s.flags & 0x10) smooth = true;
        if (s.flags & 0x20) twoSided = true;
        for (let k = 1; k < s.refs.length - 1; k++) { // triangle fan
          [s.refs[0], s.refs[k], s.refs[k + 1]].forEach(([vi, u, v]) => {
            const p = world[vi];
            positions.push(p[0], p[1], p[2]);
            uvs.push(u * texrep[0] + texoff[0], v * texrep[1] + texoff[1]);
          });
          mats.push(s.mat);
        }
      });
      if (positions.length) meshes.push({ name, path: myPath, texture, positions, uvs, materials: mats, smooth, twoSided });
    }
    for (let k = 0; k < kids; k++) {
      // advance to the next OBJECT line
      let l;
      do { l = next(); } while (l !== undefined && !l.trim().startsWith('OBJECT'));
      if (l === undefined) break;
      readObject(R, L, myPath);
    }
  }

  while (i < lines.length) {
    const l = next();
    if (l === undefined) break;
    const t = l.trim();
    if (t.startsWith('MATERIAL')) {
      const name = (t.match(/MATERIAL\s+"([^"]*)"/) || [])[1] || '';
      const get = (k, n) => { const m = t.match(new RegExp(`${k}\\s+([-\\d.e]+)${n > 1 ? '\\s+([-\\d.e]+)\\s+([-\\d.e]+)' : ''}`)); return m ? m.slice(1).map(num) : null; };
      materials.push({ name, rgb: get('rgb', 3), emis: get('emis', 3), spec: get('spec', 3), shi: (get('shi', 1) || [0])[0], trans: (get('trans', 1) || [0])[0] });
    } else if (t.startsWith('OBJECT')) {
      readObject([1, 0, 0, 0, 1, 0, 0, 0, 1], [0, 0, 0], []);
    }
  }
  return { materials, meshes };
}
