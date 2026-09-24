# SkyVision — Interactive 3D Airport Visualization

**Live demo: https://skyvision-neon.vercel.app** (runs in any modern browser; Chrome or Edge recommended)

A Computer Graphics minor project built with **WebGL + Three.js**. It has four parts:

1. **Autopilot demo:** a small fictional airport where an airliner taxis, takes off, flies a circuit, lands
   and parks in its hangar. It has five cameras, day/night lighting, and clipping and wireframe views.
2. **Fly Yourself (SkyVision valley):** you fly the aircraft over procedural terrain to two other airports and
   land wherever you choose. Every landing is scored.
3. **Fly Yourself (Mumbai region, real data):** CSMIA with its real crossing runways 09/27 and 14/32, Navi
   Mumbai International and Juhu. Everything is built from OpenStreetMap and real elevation data: about
   126,000 city buildings, the road network including the sea bridges, and parked aircraft in Indian airline
   colours at the real stands.
4. **More real Indian airports:** Bengaluru (BLR), Chennai (MAA) and Goa (GOI), each built the same way from real
   map and elevation data. Pick them under "India: more real
   airports" on the flight menu.

The real airports are alive: AI airliners land, taxi to the gates and take off around you. They fly the
same flight model and autopilot as you do. The graphics include animated reflective water, drifting
cumulus clouds, city buildings with real-sized windows and rooftop water tanks, and a glow on lights at
night.

You can fly an **Airbus A320neo, A350-900 or A380-800**. These are detailed models of the real aircraft,
converted from the open-source FlightGear simulator (see [assets/models/NOTICE.md](assets/models/NOTICE.md)).
They have moving landing gear, spinning engine fans, a windscreen you can look out of from the cockpit
camera, and lit cabin windows at night. They are repainted at runtime in logo-free Indian airline colour
schemes. After landing, **you taxi to a free gate at the terminal yourself**, following a green route
line and turn-by-turn hints (or press P for auto-taxi). The sound is procedural: turbofan spool-up, wind, runway
rumble, reverse thrust, and a tyre chirp and thud on touchdown.

## Running it

ES modules must be served over `http://`. Double-clicking `index.html` (`file://`) shows a blank page.

**Easiest (Windows):** double-click **`start.bat`**. It installs dependencies the first time, starts the
server and opens **http://localhost:5173** in your browser. Keep its window open while using the app.

**From a terminal** (run the lines one at a time; Windows PowerShell 5.1 does not support `&&`):

```powershell
cd C:\Users\ashut\Projects\skyvision
npm.cmd install
npm.cmd run dev
```

Use `npm.cmd` rather than `npm` in PowerShell. If the execution policy blocks scripts, plain `npm` fails with
"npm.ps1 cannot be loaded because running scripts is disabled on this system".

Then open **http://localhost:5173**. Three.js and the Mumbai data are stored in the project, so it works
**without internet** (useful on viva day).

## Controls: Fly Yourself

| Key | Action |
|---|---|
| `SHIFT` / `Z` | Throttle up / down (hold) |
| `S` / `W` (or `↓` / `↑`) | Nose up / nose down (`I` inverts) |
| `A` / `D` (or `←` / `→`) | Roll left / right, steer on the ground |
| `Q` / `E` | Rudder |
| `G` | Landing gear |
| `V` | Flaps: up → 1 → full |
| `B` or `SPACE` | Wheel brakes (hold) |
| `C` or `1`–`5` | Camera: Chase, Cockpit, Orbit (mouse drag), Tower, Map |
| `P` | **Autopilot**: flies to the destination and lands automatically (any flight key takes over) |
| `T` | Flight assist on/off (off = full aerobatics) |
| `R` | Restart the flight |
| `M` | **Full-screen map**: all airports, runways, taxiways, gates, traffic and your route. Click an airport to fly there |
| `U` | Mute sound |
| `P` (while taxiing) | Auto-taxi on / off |

**Autopilot:** after takeoff, press **P**. The autopilot raises the gear, climbs to a safe height, flies to
the destination, picks the best runway, follows the 3° glide path, then lands and brakes by itself. The
report then shows "Landed by: Autopilot". In free flight it holds your heading, height and speed.

**Aircraft:** pick A320, A350 or A380 on the flight menu (Mumbai flights; the valley uses a scaled A320).
The bigger jets are heavier: slower to accelerate, rotate and roll, with higher approach speeds and longer
takeoff runs (A320 ~1.1 km, A350 ~1.45 km, A380 ~1.75 km). A350s only park at stands wide enough for their
65 m wingspan, and A380s only at stands wide enough for their 80 m wingspan.

**After landing:** idle thrust deploys the reversers. When you slow down to taxi speed, a route over the real
taxiway network to the nearest free gate (preferring gates with a jet bridge) is planned and drawn as a
green line with moving arrows. **You taxi**: a little power (SHIFT), steer with A/D, and brake with B. The
hint bar shows the distance and the next turn. Stop with the nose wheel on the red bar at the gate and the
flight ends, parked. If you take a different taxiway, a new route is planned. Any free gate counts. Press
**P** to let auto-taxi drive; touch any key to take over again.

**How to land yourself:** line up with the runway and lower the gear and full flaps. Fly the PAPI lights (two white
and two red means you're on the glide path). Hold about 130 kt in Mumbai (55 kt in the valley), ease the
descent just above the runway, close the throttle, then brake.

## Controls: Autopilot demo and both modes

| Key | Action |
|---|---|
| `SPACE` | Start / pause / resume the demo flight |
| `C` or `1`–`5` | Camera: Top (orthographic), Airport, Follow, Tower, Free |
| `R` | Reset aircraft to the hangar |
| `W A S D Q E` + mouse drag | Free camera (hold `Shift` = fast) |
| `+` / `-` | Animation speed 0.5x – 4x |
| `N` | Day / night |
| Mouse wheel | Zoom / camera distance |
| `K` | Clipping-plane demonstration (SkyVision world) |
| `F` | Wireframe view |
| `H` | Hide / show HUD |
| `O` | Save a PNG screenshot |
| `ESC` | Pause menu |

## Playing on a phone or tablet

Open **https://skyvision-neon.vercel.app** on your phone and hold it in **landscape**. On-screen controls
appear automatically:

| Control | Action |
|---|---|
| Left stick | Drag down = nose up, up = nose down, sideways = roll / steer on the ground |
| THR slider (right) | Slide up for more power, down for less |
| AP | Autopilot: flies to the destination and lands (move the stick or throttle to take over); while taxiing, auto-taxi on / off |
| GEAR / FLAPS / BRAKE | Landing gear, flaps (up → 1 → full), wheel brakes (hold) |
| CAM / DAY/NIGHT / MAP / II | Change camera, day or night, full-screen map (pinch to zoom, tap an airport to fly there), pause menu |
| Drag the 3D view | Look around in the Orbit camera |

- **Android (Chrome):** tapping a mission goes fullscreen and locks the screen to landscape.
- **iPhone (Safari):** websites can't lock the orientation, so SkyVision shows "rotate your phone" in portrait.
- **App-like mode:** use the browser's **Add to Home Screen**. SkyVision then opens fullscreen in landscape,
  with its own icon.

## Rebuilding the real-world data (optional)

The data in `assets/data/` is already built. To rebuild a region (needs internet, takes a few minutes each):

```powershell
node tools/build-region-data.mjs mumbai
```

The regions in the game are `mumbai`, `bengaluru`, `chennai` and `goa`. The script also knows `delhi`,
`hyderabad` and `kolkata`, for adding them later.

Downloads are cached in `tools/.cache/`, which can be deleted to save space.

## Project structure

```
index.html              menus, HUDs, controls panel
css/style.css           UI styling
js/main.js              app bootstrap, worlds, state (menu/loading/running/paused/report), keys, main loop
js/core/                Renderer, Scene graph root, ClippingDemo, PostFX (night bloom)
js/airport/             SkyVision home airport: Runway (generic, also used for Mumbai), Taxiway, Terminal,
                        Tower, Hangar, Road + car park, Signs, Environment
js/aircraft/            Aircraft (real model + procedural fallback), ModelLibrary (loads / clones the glTF
                        models), LiveryPainter (repaints them), AircraftTypes (dimensions + handling),
                        LiveryTexture (painted fuselage texture), Liveries, Fleet (instanced parked aircraft),
                        FlightPath + FlightController (autopilot demo)
js/flight/              FlightModel (physics), PlayerFlight (landing/crash logic), Autopilot, Taxi (taxi graph,
                        Dijkstra, pure-pursuit steering), TaxiRoute (green route line), Missions, Effects,
                        EngineSound (procedural Web Audio)
js/world/               AirfieldData, Terrain + Scenery (SkyVision valley), Airfields, RunwayAids (PAPI, beacons),
                        Regions (real airport list), Water (animated sea), Clouds, AirTraffic (AI airliners),
                        SkyVisionWorld, WorldMap (minimap image)
js/world/mumbai/        MumbaiData (loader, height/water/obstacle queries), MumbaiTerrain (terrain, sea, roads),
                        MumbaiCity (instanced buildings), MumbaiAirports (runways, taxiways, aprons, terminals,
                        jet bridges, towers, fleet), MumbaiWorld
js/vehicles/            Vehicle models, VehicleManager (spline paths)
js/camera/              CameraManager (demo and flight camera sets)
js/lighting/            LightingManager, Sky (shader dome + stars), LightRegistry (night lights, lamp batches)
js/input/               InputManager (keyboard + mouse)
js/ui/                  Menu (incl. airport list), HUD (demo), FlightHUD (compass, attitude, minimap),
                        MapView (full-screen map with a top-down "satellite" render)
js/utils/               MathUtils, Textures (procedural canvas textures)
tools/                  build-region-data.mjs (OpenStreetMap + elevation -> assets/data, per region),
                        convert-aircraft.mjs + ac3d.mjs (FlightGear AC3D models -> assets/models)
assets/models/          A320 / A350 / A380 models (glTF), textures and paint maps (GPL-2.0, see NOTICE.md)
assets/data/            Mumbai region data (JSON + binary height and building grids)
docs/                   Project report and viva questions
```

## Credits

- Map data © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, available under the ODbL.
- Elevation: AWS Terrain Tiles (SRTM and other public sources).
- Aircraft models: converted from the FlightGear A320 family (legoboyvdlp/A320-family), A350 family
  (ImFrustrated45/A350-Family) and A380 (FGMEMBERS/A380-omega) aircraft, GPL-2.0. See
  [assets/models/NOTICE.md](assets/models/NOTICE.md) for the sources and the changes made.
- Airline colour schemes are simplified approximations for an educational, non-commercial project; no logos
  are reproduced and the project is not affiliated with any airline.

## Documentation

- [docs/Project_Report.md](docs/Project_Report.md): full project report (abstract through conclusion)
- [docs/Viva_Questions.md](docs/Viva_Questions.md): likely viva questions with short answers
