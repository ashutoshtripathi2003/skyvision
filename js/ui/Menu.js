import { MISSIONS, airportMissions } from '../flight/Missions.js';
import { REGIONS, NEW_REGIONS } from '../world/Regions.js';
import { LIVERIES, INDIAN_AIRLINES } from '../aircraft/Liveries.js';
import { AIRCRAFT_TYPES, TYPE_KEYS } from '../aircraft/AircraftTypes.js';

// All HTML overlay screens: main menu, mission select (with airline picker),
// loading, landing report, crash, controls, pause and exit.
const $ = (id) => document.getElementById(id);
const SCREENS = ['menu', 'missions', 'loading', 'results', 'crash', 'controls', 'pause', 'exit'];
const AIRLINE_CHOICES = [...INDIAN_AIRLINES, 'skyvision'];

const TYPE_NOTES = {
  a320: 'Single aisle · 38 m · nimble',
  a350: 'Wide-body · 67 m · long haul',
  a380: 'Double-deck · 73 m · 4 engines',
};

function readSaved(key, choices, fallback) {
  try {
    const saved = localStorage.getItem(key);
    return choices.includes(saved) ? saved : fallback;
  } catch {
    return fallback;
  }
}

function readSavedAirline() {
  try {
    const saved = localStorage.getItem('skyvision.airline');
    return AIRLINE_CHOICES.includes(saved) ? saved : 'indigo';
  } catch {
    return 'indigo';
  }
}

export class Menu {
  constructor(handlers) {
    this.handlers = handlers;
    this.screens = SCREENS.map($);
    this.returnTo = 'menu';
    this.airline = readSavedAirline();
    this.aircraftType = readSaved('skyvision.type', TYPE_KEYS, 'a320');

    $('btn-fly').onclick = () => this.show('missions');
    $('btn-start').onclick = handlers.onStartDemo;
    $('btn-controls').onclick = () => this.showControls('menu');
    $('btn-exit').onclick = () => this.exit();
    $('btn-missions-back').onclick = () => this.show('menu');
    $('btn-controls-close').onclick = () => this.show(this.returnTo);
    $('btn-resume').onclick = handlers.onResume;
    $('btn-restart').onclick = handlers.onRestart;
    $('btn-pause-controls').onclick = () => this.showControls('pause');
    $('btn-main-menu').onclick = handlers.onMainMenu;
    $('btn-back').onclick = () => this.show('menu');
    $('btn-results-missions').onclick = () => this.show('missions');
    $('btn-results-menu').onclick = handlers.onMainMenu;
    $('btn-crash-retry').onclick = handlers.onRestart;
    $('btn-crash-missions').onclick = () => this.show('missions');
    $('btn-crash-menu').onclick = handlers.onMainMenu;

    this.buildAirlinePicker();
    this.buildTypePicker();
    this.buildMissionCards();
    this.buildAirportList();
  }

  // One card per extra real airport, each with "take off" and "final approach".
  buildAirportList() {
    const list = $('airport-list');
    NEW_REGIONS.forEach((id) => {
      const region = REGIONS[id];
      const [takeoff, final] = airportMissions(id, region);
      const card = document.createElement('div');
      card.className = 'airport-card';
      card.id = `airport-${id}`;
      const code = document.createElement('span');
      code.className = 'airport-code';
      code.textContent = region.airports[0];
      const title = document.createElement('h3');
      title.textContent = region.city || region.name;
      const blurb = document.createElement('p');
      blurb.textContent = region.blurb;
      const buttons = document.createElement('div');
      buttons.className = 'airport-buttons';
      [[takeoff, 'TAKE OFF'], [final, 'ON FINAL']].forEach(([mission, label]) => {
        const b = document.createElement('button');
        b.id = `mission-${mission.id}`;
        b.textContent = label;
        b.onclick = () => this.handlers.onStartMission(mission);
        buttons.appendChild(b);
      });
      card.append(code, title, blurb, buttons);
      list.appendChild(card);
    });
  }

  buildTypePicker() {
    const row = $('type-list');
    TYPE_KEYS.forEach((key) => {
      const chip = document.createElement('button');
      chip.className = 'type-chip';
      chip.id = `type-${key}`;
      chip.setAttribute('aria-pressed', String(key === this.aircraftType));
      const name = document.createElement('strong');
      name.textContent = AIRCRAFT_TYPES[key].short;
      const note = document.createElement('span');
      note.textContent = TYPE_NOTES[key];
      chip.append(name, note);
      chip.onclick = () => {
        this.aircraftType = key;
        try { localStorage.setItem('skyvision.type', key); } catch { /* storage unavailable */ }
        row.querySelectorAll('.type-chip').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      };
      row.appendChild(chip);
    });
  }

  buildAirlinePicker() {
    const row = $('airline-list');
    AIRLINE_CHOICES.forEach((key) => {
      const livery = LIVERIES[key];
      const chip = document.createElement('button');
      chip.className = 'airline';
      chip.id = `airline-${key}`;
      chip.setAttribute('aria-pressed', String(key === this.airline));
      const swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = `#${livery.tail.toString(16).padStart(6, '0')}`;
      chip.append(swatch, document.createTextNode(livery.name));
      chip.onclick = () => {
        this.airline = key;
        try { localStorage.setItem('skyvision.airline', key); } catch { /* storage unavailable */ }
        row.querySelectorAll('.airline').forEach((c) => c.setAttribute('aria-pressed', String(c === chip)));
      };
      row.appendChild(chip);
    });
  }

  buildMissionCards() {
    MISSIONS.forEach((mission) => {
      const card = document.createElement('button');
      card.className = 'mission';
      card.id = `mission-${mission.id}`;
      const chip = document.createElement('span');
      chip.className = `chip ${mission.difficulty.toLowerCase()}`;
      chip.textContent = mission.difficulty.toUpperCase();
      const title = document.createElement('h3');
      title.textContent = mission.title;
      const route = document.createElement('span');
      route.className = 'route';
      route.textContent = mission.route;
      const blurb = document.createElement('p');
      blurb.textContent = mission.blurb;
      card.append(chip, title, route, blurb);
      card.onclick = () => this.handlers.onStartMission(mission);
      $(`mission-list-${mission.world}`).appendChild(card);
    });
  }

  show(id) {
    this.screens.forEach((s) => s.classList.toggle('hidden', s.id !== id));
    const primary = id && $(id).querySelector('button.primary, .mission');
    if (primary) primary.focus();
  }

  hideAll() {
    this.show(null);
  }

  showControls(returnTo) {
    this.returnTo = returnTo;
    this.show('controls');
  }

  showLoading(step) {
    $('loading-step').textContent = step;
    this.show('loading');
  }

  setLoadingStep(step) {
    $('loading-step').textContent = step;
  }

  get controlsOpen() {
    return !$('controls').classList.contains('hidden');
  }

  // airports: the current world's airports, used for the "fly on from here" buttons.
  showResults(report, airports) {
    const airport = report.airport;
    $('results-status').textContent = report.success ? 'LANDED · MISSION COMPLETE' : 'LANDED';
    $('results-title').textContent = airport ? airport.name.toUpperCase() : 'OFF-AIRPORT LANDING';

    const stars = $('results-stars');
    stars.replaceChildren();
    for (let i = 1; i <= 5; i++) {
      const s = document.createElement('span');
      s.textContent = '★';
      if (i > report.stars) s.className = 'off';
      stars.appendChild(s);
    }
    stars.setAttribute('aria-label', `${report.stars} of 5 stars`);
    $('results-verdict').textContent = `${report.verdict} · score ${report.score}/100`;

    const rows = [
      ...report.rows,
      ['Flight time', `${Math.floor(report.time / 60)}:${String(Math.round(report.time % 60)).padStart(2, '0')}`],
      ['Distance flown', `${(report.distance / 1000).toFixed(1)} km`],
    ];
    const table = $('results-table');
    table.replaceChildren();
    rows.forEach(([label, value]) => {
      const tr = table.insertRow();
      tr.insertCell().textContent = label;
      tr.insertCell().textContent = value;
    });

    // "Fly on" buttons: take off from where you landed towards any other airport.
    const next = $('results-next');
    next.replaceChildren();
    if (airport) {
      airports.filter((a) => a.id !== airport.id).forEach((dest, i) => {
        const b = document.createElement('button');
        if (i === 0) b.className = 'primary';
        b.textContent = `FLY TO ${dest.short.toUpperCase()}`;
        b.onclick = () => this.handlers.onFlyOn(airport.id, dest.id);
        next.appendChild(b);
      });
      const free = document.createElement('button');
      free.textContent = 'FREE FLIGHT FROM HERE';
      free.onclick = () => this.handlers.onFlyOn(airport.id, null);
      next.appendChild(free);
    } else {
      const retry = document.createElement('button');
      retry.className = 'primary';
      retry.textContent = 'RESTART FLIGHT';
      retry.onclick = this.handlers.onRestart;
      next.appendChild(retry);
    }
    this.show('results');
  }

  showCrash({ reason, time, distance }) {
    $('crash-reason').textContent = reason;
    $('crash-detail').textContent = `After ${Math.floor(time / 60)}:${String(Math.round(time % 60)).padStart(2, '0')} and ${(distance / 1000).toFixed(1)} km.`;
    this.show('crash');
  }

  exit() {
    this.show('exit');
    window.close(); // only works if the tab was opened by a script; the exit screen covers the other case
  }
}
