// Airline colour schemes. The Indian airline schemes are simplified,
// colour-inspired approximations (tail, engines, cheatline, belly, fuselage
// title) for an educational, non-commercial project - no logos are reproduced
// and the project is not affiliated with any airline.
//
// body / tail / engine / cheat / belly: colours; belly and cheat may be null.
// tailAccent: a simple geometric decoration on the fin (stripe or dots).
export const LIVERIES = {
  skyvision: {
    name: 'SkyVision', body: 0xf4f6f8, tail: 0x1f5fbf, engine: 0xd9dee3, cheat: 0x1f5fbf, belly: null,
    tailAccent: { kind: 'stripe', color: 0x7fb2ff }, title: 'SKYVISION', titleColor: '#1f5fbf', titleFont: 'bold italic',
  },
  indigo: {
    name: 'IndiGo', body: 0xf5f6f8, tail: 0x1c2a82, engine: 0x1c2a82, cheat: null, belly: 0x1c2a82,
    tailAccent: { kind: 'dots', color: 0xffffff }, title: 'IndiGo', titleColor: '#1c2a82', titleFont: 'bold',
  },
  airindia: {
    name: 'Air India', body: 0xf7f5f3, tail: 0xc8102e, engine: 0x5c1f4a, cheat: 0xd4a44c, belly: null,
    tailAccent: { kind: 'stripe', color: 0xd4a44c }, title: 'AIR INDIA', titleColor: '#c8102e', titleFont: 'bold',
  },
  akasa: {
    name: 'Akasa Air', body: 0xf7f5f3, tail: 0xff6a2d, engine: 0xff6a2d, cheat: null, belly: null,
    tailAccent: { kind: 'stripe', color: 0xffc0a0 }, title: 'Akasa Air', titleColor: '#ff6a2d', titleFont: 'bold',
  },
  spicejet: {
    name: 'SpiceJet', body: 0xf7f5f3, tail: 0xd7191f, engine: 0xd7191f, cheat: null, belly: 0xd7191f,
    tailAccent: { kind: 'stripe', color: 0xf2a900 }, title: 'SpiceJet', titleColor: '#d7191f', titleFont: 'bold italic',
  },
  aiexpress: {
    name: 'Air India Express', body: 0xf7f5f3, tail: 0xf15a22, engine: 0x0aa39b, cheat: 0x0aa39b, belly: null,
    tailAccent: { kind: 'stripe', color: 0x0aa39b }, title: 'AIR INDIA EXPRESS', titleColor: '#f15a22', titleFont: 'bold',
  },
};

export const INDIAN_AIRLINES = ['indigo', 'airindia', 'akasa', 'spicejet', 'aiexpress'];

// Rough share of parked aircraft per airline at each airport (weights).
export const FLEET_MIX = {
  BOM: { indigo: 38, airindia: 26, akasa: 12, spicejet: 10, aiexpress: 14 },
  NMI: { indigo: 45, akasa: 25, aiexpress: 20, airindia: 10 },
};
