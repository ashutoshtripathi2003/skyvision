import { fromRunwayLocal } from '../world/AirfieldData.js';

// Player missions. from/to are airport ids; depart/arrive are runway numbers
// (optional - the longest runway's first direction is used if omitted).
// start 'runway' = lined up for takeoff, 'final' = airborne on a stabilised approach.
export const MISSIONS = [
  {
    id: 'lakeview', route: 'SkyVision → Lakeview · 4.2 km', world: 'skyvision', title: 'Lakeside Hop', from: 'SKV', to: 'LKV', start: 'runway', difficulty: 'Easy',
    blurb: 'Take off from SkyVision, cross the farmland and land on Lakeview\'s long runway by the lake.',
  },
  {
    id: 'summit', route: 'SkyVision → Summit · 4.9 km', world: 'skyvision', title: 'Mountain Run', from: 'SKV', to: 'SMT', start: 'runway', difficulty: 'Hard',
    blurb: 'Climb over the ridges to a short strip on a plateau at 300 m. Watch the terrain and your speed.',
  },
  {
    id: 'approach', route: '2 km final → SkyVision', world: 'skyvision', title: 'Final Approach', from: 'SKV', to: 'SKV', start: 'final', difficulty: 'Training',
    blurb: 'Start 2 km out on final to SkyVision. Follow the PAPI lights and put it on the centreline.',
  },
  {
    id: 'free', route: 'SkyVision → anywhere', world: 'skyvision', title: 'Free Flight', from: 'SKV', to: null, start: 'runway', difficulty: 'Open',
    blurb: 'No target. Explore the valley and land at any of the three airports.',
  },
  {
    id: 'bom-nmi', route: 'BOM 09 → Navi Mumbai · 24 km', world: 'mumbai', title: 'Mumbai to Navi Mumbai', from: 'BOM', depart: '09', to: 'NMI', start: 'runway', difficulty: 'Normal',
    blurb: 'Depart CSMIA runway 09, cross Thane Creek and the harbour, and land on Navi Mumbai\'s 3.7 km runway.',
  },
  {
    id: 'nmi-bom', route: 'Navi Mumbai 26 → BOM · 24 km', world: 'mumbai', title: 'Navi Mumbai to Mumbai', from: 'NMI', depart: '26', to: 'BOM', start: 'runway', difficulty: 'Hard',
    blurb: 'Fly west over the harbour and land on either of CSMIA\'s crossing runways, 09/27 or 14/32.',
  },
  {
    id: 'bom-27', route: '7 km final → BOM runway 27', world: 'mumbai', title: 'Mumbai 27 Approach', from: 'BOM', arrive: '27', to: 'BOM', start: 'final', difficulty: 'Training',
    blurb: 'Start 7 km out on final for runway 27, descending over the city towards CSMIA.',
  },
  {
    id: 'mumbai-free', route: 'BOM 27 → your choice', world: 'mumbai', title: 'Free Flight: Mumbai', from: 'BOM', depart: '27', to: null, start: 'runway', difficulty: 'Open',
    blurb: 'Take off over the Arabian Sea and land at Mumbai, Navi Mumbai or tiny Juhu - your choice.',
  },
];

// Two ready-made flights for every other real airport: take off and land back
// (fly a circuit, or anywhere else you like), or start 7 km out on final.
export function airportMissions(regionId, region) {
  const airport = region.airports[0];
  return [
    {
      id: `${regionId}-circuit`, world: regionId, title: `${region.name}: take off`, from: airport, to: airport,
      start: 'runway', difficulty: 'Normal', route: `${airport} · circuit`,
      blurb: 'Line up on the longest runway, fly a circuit and land back.',
    },
    {
      id: `${regionId}-final`, world: regionId, title: `${region.name}: final approach`, from: airport, to: airport,
      start: 'final', difficulty: 'Training', route: `7 km final → ${airport}`,
      blurb: 'Start stabilised on final. Land, then taxi to a gate.',
    },
  ];
}

export function findRunway(world, airportId, label) {
  const runways = world.runways.filter((r) => r.airport === airportId);
  return runways.find((r) => label && r.designators.includes(label))
    || [...runways].sort((a, b) => b.length - a.length)[0];
}

// Spawn state for the flight model. A runway's designators[0] direction runs
// towards its local -Z (world heading = rotation + PI); designators[1] the other way.
// perf / size: the chosen aircraft's performance and size (1 = the SkyVision trainer).
export function spawnFor(world, airportId, label, start, { perf = world.performance, size = world.aircraftScale } = {}) {
  const runway = findRunway(world, airportId, label);
  const sign = !label || runway.designators[0] === label ? 1 : -1;
  const heading = runway.rotation + (sign > 0 ? Math.PI : 0);
  const halfL = runway.length / 2;

  if (start === 'final') {
    const distance = world.finalDistance;
    const glide = (world.glideSlope * Math.PI) / 180;
    const p = fromRunwayLocal(runway, 0, sign * (halfL + distance));
    const height = Math.max(runway.y + Math.tan(glide) * distance, world.heightAt(p.x, p.z) + 120);
    // Stabilised: full flaps, gear down, nose on the glide path, power set so speed holds.
    const speed = perf.stallSpeed[2] * 1.35;
    const drag = perf.drag * (1 + perf.flapDrag[2] + perf.gearDrag) * speed * speed;
    const throttle = Math.min(1, Math.max(0.05, (drag - 9.81 * Math.sin(glide)) / perf.thrust));
    return {
      position: { x: p.x, y: height, z: p.z }, heading, airborne: true,
      speed, throttle, flaps: 2, gearDown: true, pitch: -glide, runway,
    };
  }
  const p = fromRunwayLocal(runway, 0, sign * (halfL - 18 * size));
  return {
    position: { x: p.x, y: runway.y, z: p.z }, heading, airborne: false,
    speed: 0, throttle: 0, flaps: 1, gearDown: true, pitch: 0, runway,
  };
}
