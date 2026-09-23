// Real-world dimensions (metres) for the three airliner types, plus their
// handling. Model frame: nose +Z, up +Y, left wing +X, origin on the ground
// under the main landing gear. Numbers are rounded published figures.
//
// fuselage: radius, vertical stretch (the A380 is taller than it is wide),
//           height of the centre line above the ground, nose / tail z.
// wing: stations from root to tip: [span x, leading-edge z, chord, height offset, thickness].
export const AIRCRAFT_TYPES = {
  a320: {
    name: 'Airbus A320', short: 'A320',
    length: 37.6,
    fuselage: { radius: 1.98, stretchY: 1.0, centreY: 3.95, noseZ: 17.6, tailZ: -20.0, noseLength: 5.6, tailLength: 9.5, tailRise: 1.1 },
    wing: {
      rootY: 2.45,
      stations: [[1.9, 4.1, 7.0, 0.0, 0.14], [6.3, 1.9, 4.6, 0.38, 0.12], [17.3, -4.6, 1.55, 1.34, 0.1]],
      tip: { type: 'sharklet', height: 2.4, chord: 1.2 },
    },
    stabiliser: { y: 4.8, stations: [[0.4, -14.6, 4.0], [6.2, -18.1, 1.5]] },
    fin: { rootZ: -13.3, rootChord: 6.2, tipZ: -18.9, tipChord: 2.0, height: 6.2 },
    engines: [{ x: 5.75, y: 1.55, z: 3.0 }],
    nacelle: { length: 4.4, radius: 1.03, inlet: 0.9, exhaust: 0.62 },
    gear: { nose: { z: 12.5, wheels: 2, radius: 0.37 }, main: [{ x: 3.8, z: 0, rows: 1, radius: 0.57 }] },
    doors: [0.93, 0.18, 0.08],
    windows: { decks: 1, pitch: 0.53, from: 0.22, to: 0.88 },
    cockpitMask: false,
    bellyClearance: 1.95,
  },
  a350: {
    name: 'Airbus A350-900', short: 'A350',
    length: 66.8,
    fuselage: { radius: 2.98, stretchY: 1.0, centreY: 5.25, noseZ: 34.6, tailZ: -32.2, noseLength: 8.2, tailLength: 15, tailRise: 1.6 },
    wing: {
      rootY: 3.4,
      stations: [[3.0, 7.0, 12.2, 0.0, 0.14], [11.5, 1.2, 6.8, 0.75, 0.12], [29.5, -10.6, 2.3, 2.3, 0.1]],
      tip: { type: 'curved', length: 3.0, rise: 2.6 },
    },
    stabiliser: { y: 6.6, stations: [[0.6, -24.4, 6.8], [9.2, -30.2, 2.2]] },
    fin: { rootZ: -21.0, rootChord: 10.4, tipZ: -30.9, tipChord: 3.4, height: 8.8 },
    engines: [{ x: 9.6, y: 2.6, z: 6.0 }],
    nacelle: { length: 6.2, radius: 1.72, inlet: 1.5, exhaust: 1.0 },
    gear: { nose: { z: 28.7, wheels: 2, radius: 0.55 }, main: [{ x: 5.4, z: 0, rows: 2, radius: 0.67 }] },
    doors: [0.92, 0.66, 0.36, 0.08],
    windows: { decks: 1, pitch: 0.6, from: 0.14, to: 0.9 },
    cockpitMask: true,
    bellyClearance: 2.3,
  },
  a380: {
    name: 'Airbus A380-800', short: 'A380',
    length: 72.7,
    fuselage: { radius: 3.57, stretchY: 1.18, centreY: 6.55, noseZ: 38.1, tailZ: -34.6, noseLength: 9.8, tailLength: 17, tailRise: 1.8 },
    wing: {
      rootY: 3.7,
      stations: [[3.6, 11.0, 17.8, 0.0, 0.13], [16.0, 0.6, 9.4, 1.05, 0.11], [39.2, -15.8, 3.9, 2.8, 0.09]],
      tip: { type: 'fence', height: 1.9, chord: 3.0 },
    },
    stabiliser: { y: 7.4, stations: [[0.8, -24.0, 9.6], [15.2, -32.6, 3.2]] },
    fin: { rootZ: -19.6, rootChord: 13.8, tipZ: -32.8, tipChord: 4.6, height: 13.0 },
    engines: [{ x: 15.4, y: 3.1, z: 6.0 }, { x: 25.8, y: 3.7, z: -1.6 }],
    nacelle: { length: 5.8, radius: 1.68, inlet: 1.46, exhaust: 0.95 },
    gear: {
      nose: { z: 33.6, wheels: 2, radius: 0.6 },
      main: [{ x: 6.1, z: 1.2, rows: 2, radius: 0.67 }, { x: 2.1, z: -2.2, rows: 3, radius: 0.67 }],
    },
    doors: [0.93, 0.7, 0.45, 0.2],
    windows: { decks: 2, pitch: 0.6, from: 0.12, to: 0.9 },
    cockpitMask: false,
    bellyClearance: 2.35,
  },
};

// Handling. The same flight-model equations, heavier aircraft = less thrust per
// kilogram, higher speeds, slower rotation and longer takeoff / landing rolls.
export const PERFORMANCE_BY_TYPE = {
  a320: {
    thrust: 3.0, drag: 0.00013, stallSpeed: [66, 58, 52], flapDrag: [0, 0.35, 0.9], gearDrag: 0.25,
    pitchRate: 0.3, rollRate: 0.95, yawRate: 0.2, steerRate: 0.45, brakeDecel: 3.2, rollingFriction: 0.25,
    gearTransit: 6, maxGroundPitch: 0.21, reverseDecel: 1.3,
  },
  a350: {
    thrust: 2.7, drag: 0.000112, stallSpeed: [70, 62, 55], flapDrag: [0, 0.35, 0.9], gearDrag: 0.25,
    pitchRate: 0.24, rollRate: 0.75, yawRate: 0.16, steerRate: 0.38, brakeDecel: 3.0, rollingFriction: 0.25,
    gearTransit: 7, maxGroundPitch: 0.2, reverseDecel: 1.25,
  },
  a380: {
    thrust: 2.45, drag: 0.0001, stallSpeed: [72, 64, 56], flapDrag: [0, 0.35, 0.9], gearDrag: 0.25,
    pitchRate: 0.2, rollRate: 0.6, yawRate: 0.14, steerRate: 0.34, brakeDecel: 2.8, rollingFriction: 0.25,
    gearTransit: 8, maxGroundPitch: 0.19, reverseDecel: 1.2,
  },
};

export const TYPE_KEYS = ['a320', 'a350', 'a380'];

// The original trainer model was 27 m long; "size" 1.4 in the world data means a
// real A320. Real-metre models are therefore drawn at worldScale / 1.4.
export const A320_WORLD_SCALE = 1.4;
