// The real-world regions (built by tools/build-region-data.mjs into
// assets/data/<id>.json + .bin files). Each is its own flyable world.
export const REGIONS = {
  mumbai: { name: 'Mumbai Region', airports: ['BOM', 'NMI', 'JUH'], mapRange: 14000 },
  bengaluru: {
    name: 'Bengaluru', airports: ['BLR'], city: 'Bengaluru', mapRange: 9000,
    blurb: 'Kempegowda International, 915 m up on the Deccan plateau, with two parallel 4 km runways.',
  },
  chennai: {
    name: 'Chennai', airports: ['MAA'], city: 'Chennai', mapRange: 9000,
    blurb: 'Crossing runways close to the Bay of Bengal coast, with the city all around.',
  },
  goa: {
    name: 'Goa', airports: ['GOI'], city: 'Goa (Dabolim)', mapRange: 9000,
    blurb: 'A plateau airport between the Zuari river and the Arabian Sea beaches.',
  },
};

export const NEW_REGIONS = ['bengaluru', 'chennai', 'goa'];
