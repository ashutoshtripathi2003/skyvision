# SKYVISION: Interactive 3D Airport Visualization System

**Computer Graphics Minor Project, B.Tech/B.E. Information Technology (3rd Year)**

---

## 1. Abstract

SkyVision is an interactive 3D airport environment rendered in real time in a web browser using WebGL
through the Three.js library. The scene has a runway, taxiways, apron, passenger terminal, air-traffic-control
tower, maintenance hangar, landside roads, a car park, signage, trees and terrain. A primitive-built
airliner runs an automated ten-phase sequence: it taxis from the hangar, lines up, accelerates, lifts off,
climbs, turns around, approaches, lands and taxis back to the hangar. Three ground vehicles move
continuously along spline paths.

The user can switch between five camera modes (orthographic top view, fixed cinematic view, chase camera,
tower camera and free-fly camera) and toggle a day/night lighting system. At night, runway, taxiway,
terminal, floodlight and aircraft lights switch on. A clipping-plane demonstration and a wireframe mode show
the underlying graphics pipeline. The project demonstrates geometric transformations, 3D modelling,
perspective and parallel projection, viewing transformations, curve-based animation, lighting, shadows,
texture mapping and clipping. It runs smoothly on an ordinary college laptop.

Two interactive modes extend the demonstration. In **Fly Yourself**, the user pilots the aircraft with the
keyboard. A simplified flight model (thrust, drag, lift, coordinated turns, stall) drives it, and every
landing is judged on touchdown rate, centreline offset, alignment and touchdown point.

In the **Mumbai region** mode, a real-world scene is generated from open data: OpenStreetMap geometry for
Chhatrapati Shivaji Maharaj International Airport (with its crossing runways 09/27 and 14/32), Navi Mumbai
International Airport and Juhu Aerodrome, about 126,000 city buildings and the major road network, plus real
elevation data for the terrain and coastline. Latitude/longitude are projected to a local plane, and
polygons are triangulated and extruded into 3D. Thousands of objects are drawn efficiently with GPU
instancing, including parked aircraft in Indian airline colour schemes at the real stands.

## 2. Problem Statement

Computer Graphics concepts such as transformations, projections, viewing and lighting are usually taught
with isolated examples: a rotating cube, a single projected triangle. Students rarely see these concepts
working together in one coherent, interactive scene, which makes it hard to see why each concept matters.
There is a need for a compact, visually appealing application in which each concept is visibly used and
can be pointed to in the source code.

## 3. Objectives

1. Model a recognisable 3D airport and aircraft using only geometric primitives.
2. Apply translation, rotation, scaling and composite transformations to animate an aircraft and vehicles.
3. Implement perspective and orthographic projection with multiple camera (viewing) modes.
4. Implement a lighting model with a smooth day/night transition and night-time artificial lights.
5. Demonstrate clipping with a user-controlled clipping plane, alongside the camera's near/far clipping planes.
6. Provide a clean menu and HUD so the application can be demonstrated and explained easily.
7. Keep the project light enough to run at interactive frame rates on a normal laptop without installation.

## 4. Existing System

- **Textbook/lab programs** (C + OpenGL/GLUT): demonstrate one concept at a time with simple shapes and
  little visual context.
- **Commercial flight simulators** (e.g., Microsoft Flight Simulator, X-Plane): realistic but huge and
  closed-source. They need powerful hardware, and they hide every graphics concept from the learner.
- **Game engines** (Unity, Unreal): produce good visuals quickly, but the editor abstracts the pipeline, so
  projection, viewing and transformation code is rarely written by the student.

## 5. Proposed System

SkyVision sits between these: a small, self-contained 3D application where the student writes the
modelling, transformation, camera, animation and lighting logic. Three.js provides the WebGL
rendering back end, scene graph and standard matrices. Every concept can be traced to a specific file and
function. The system runs in any modern browser, needs no installation for the viewer, and can run
offline.

## 6. Hardware Requirements

| Component | Minimum |
|---|---|
| Processor | Intel Core i3 / AMD Ryzen 3 or equivalent |
| RAM | 4 GB |
| Graphics | Any WebGL 2 capable integrated GPU (Intel UHD 620 or better) |
| Display | 1366 × 768 or higher |
| Input | Keyboard and mouse |

## 7. Software Requirements

| Item | Used |
|---|---|
| Operating system | Windows 10/11, Linux or macOS |
| Browser | Google Chrome / Microsoft Edge / Firefox (latest) with WebGL 2 |
| Language | JavaScript (ES Modules), HTML5, CSS3, GLSL (sky shader) |
| Graphics library | Three.js r169 (WebGL wrapper), vendored locally |
| Development server | Node.js + `http-server` (`npm run dev`) |
| Real-world data | OpenStreetMap (Overpass API), AWS Terrain Tiles; processed once by `tools/build-mumbai-data.mjs` (Node.js + `pngjs`) |
| Editor | Visual Studio Code |

## 8. System Architecture

```
               +-------------------------- main.js ---------------------------+
               |  state machine (menu / sim / paused), key bindings, main loop |
               +---------------------------------------------------------------+
                  |          |            |             |            |      |
             InputManager  Menu/HUD  CameraManager  LightingManager  Flight  Vehicle
             (keys,mouse)   (DOM)    (5 modes)      (sun, sky,       Ctrl    Manager
                                                     registry)        |
                                                         |          FlightPath
    Scene graph:  scene                                  |          (curves)
                   |- Sky dome + stars  <----------------+
                   |- Hemisphere + Directional light
                   |- world ---------------------------------+  (clipping applies here)
                        |- Airport: Environment, Runway, Taxiways, Terminal,
                        |           Tower, Hangar, Roads, Signs, gate aircraft
                        |- Main Aircraft (root -> fuselage, wings, tail, gear, lights)
                        |- Vehicles (bus, fuel truck, baggage tug + carts)

    Every frame:  input -> update animation (flight, vehicles) -> update lights ->
                  update camera -> WebGL render (vertex shader -> clipping ->
                  rasterisation -> fragment shader / lighting -> depth test -> screen)
```

### Module responsibilities

| Module | Purpose |
|---|---|
| `main.js` | Creates everything, owns the application state and the render loop |
| `core/Renderer.js` | WebGL renderer, shadow maps, tone mapping |
| `core/Scene.js` | Scene graph root and the `world` group |
| `core/ClippingDemo.js` | User clipping plane (key K) |
| `airport/*` | Static models: runway, taxiways/apron, terminal, tower, hangar, roads, signs, terrain |
| `aircraft/Aircraft.js` | Hierarchical aircraft model, landing-gear retraction, aircraft lights |
| `aircraft/FlightPath.js` | The ten flight phases as curves + timing + easing |
| `aircraft/FlightController.js` | Converts time into position/heading/pitch/bank each frame |
| `vehicles/*` | Vehicle models and their looping spline paths |
| `camera/CameraManager.js` | Perspective + orthographic cameras, five viewing modes |
| `lighting/*` | Sun/moon, ambient light, sky shader, stars, night-light registry |
| `input/InputManager.js` | Keyboard and mouse handling |
| `ui/Menu.js`, `ui/HUD.js` | Main/pause/controls menus and heads-up display |
| `utils/*` | Math helpers (easing, interpolation) and procedural textures |

## 9. Computer Graphics Concepts Used

| Concept | Where it is used (file) |
|---|---|
| **Translation** | Aircraft moves along its path (`FlightController.applyCurvePose`); vehicles (`VehicleManager.place`); repeated runway dashes, lights, trees (`Runway.js`, `Environment.js`) |
| **Rotation** | Aircraft yaw/pitch/roll (`rotation.set(-pitch, heading, bank)`); landing gear folding (`Aircraft.setGearExtension`); rotating radar (`Tower.js`); ground plane rotated flat (`Environment.js`) |
| **Scaling** | Nose cone = sphere scaled 1.9× along Z; hills = flattened spheres; gate aircraft scaled to 0.85; random tree sizes; terminal/hangar roofs flattened with non-uniform scale |
| **Reflection** | Right wing and right stabiliser are the left ones mirrored with `scale.x = -1` |
| **Composite transformation** | Every object's model matrix `M = T · R · S`; hierarchy: world matrix = parent world matrix × local matrix (aircraft root → wing wrapper → wing → wing-tip light) |
| **Coordinate systems** | Local (model) space of each part, world space, camera (view) space, clip space, screen space; follow camera converts an offset from aircraft space to world space |
| **3D modelling** | All objects are built from primitives: boxes, cylinders, cones, spheres, planes; wings/fins are 2D polygons **extruded** into 3D |
| **Perspective projection** | `PerspectiveCamera(55°, aspect, 0.5, 4000)` for Airport/Follow/Tower/Free views; tower camera changes FOV to zoom |
| **Parallel (orthographic) projection** | `OrthographicCamera` for the Top view; zoom scales the view volume |
| **Viewing transformation** | `camera.lookAt(target)` builds the view matrix; follow/tower cameras recompute it every frame |
| **Clipping** | Near/far planes of each camera; frustum culling of off-screen objects; user clipping plane `n·p + d = 0` sweeping across the airport (key K) |
| **Hidden-surface removal** | Z-buffer (depth test); back-face culling |
| **Animation** | Time-based kinematics with easing; Bézier and Catmull-Rom curves; frame-rate independent `dt` |
| **Curves** | Quadratic and cubic Bézier (turns, liftoff, flare), Catmull-Rom spline (taxi route, vehicle loops), arc-length parametrisation for constant speed |
| **Lighting** | Hemisphere (ambient) + directional (sun/moon) + spot lights (floodlights, landing light) + point light (hangar); emissive materials for lamps |
| **Shading** | Physically-based (Lambert diffuse + specular) per-pixel shading via `MeshStandardMaterial` |
| **Shadows** | Shadow mapping from the sun's orthographic shadow camera |
| **Texture mapping** | Procedural canvas textures (grass, asphalt, concrete, facade, signs, runway numbers) with UV repeat |
| **Blending** | Additive blended sprites for light glow; transparent textures for runway numbers and windows |
| **Fog / atmospheric perspective** | Linear fog blending distant objects into the horizon colour |
| **Custom shader** | GLSL gradient sky with sun/moon disc (`lighting/Sky.js`) |
| **Quaternions** | Player aircraft orientation: pitch/roll/yaw applied as rotations about the aircraft's own axes (`flight/FlightModel.js`), no gimbal lock |
| **Inverse transformation** | Aircraft world position -> runway-local coordinates to test "on the runway?" and score the landing (`toRunwayLocal`) |
| **Map projection** | Latitude/longitude -> local metres (equirectangular) for all Mumbai data (`tools/build-mumbai-data.mjs`) |
| **Height-field terrain** | Grid of elevations -> triangle mesh; bilinear interpolation for collision (`world/mumbai/MumbaiData.js`, `world/Terrain.js`) |
| **Procedural noise** | Fractal value noise for the SkyVision valley terrain (`world/Terrain.js`) |
| **Polygon triangulation and extrusion** | OpenStreetMap apron outlines -> triangulated `ShapeGeometry`; terminal/hangar footprints -> `ExtrudeGeometry` (`MumbaiAirports.js`) |
| **GPU instancing** | 126k city buildings, 2,600 trees, parked fleet and runway/taxiway lights drawn as `InstancedMesh`/point batches |
| **Frustum culling by chunks** | City split into a 10 x 7 grid of instanced chunks so off-screen chunks are skipped |
| **2D transformations** | HUD compass (translation), attitude indicator (rotation + translation), minimap (translate-rotate-scale of the world map) |
| **Particle system** | Tyre smoke and crash explosion sprites with velocity, growth and fade (`flight/Effects.js`) |

## 10. Algorithms

### 10.1 Transformation of a model (composite matrix)

For every object the renderer computes its model (local) matrix from position `t`, Euler rotation
`(rx, ry, rz)` and scale `s`:

```
M_local = T(t) · R(rotation) · S(s)
M_world = M_world(parent) · M_local
```

Translation, rotation (about Y) and scaling in homogeneous coordinates:

```
T = | 1 0 0 tx |    Ry = |  cosθ 0 sinθ 0 |    S = | sx 0  0  0 |
    | 0 1 0 ty |         |   0   1  0   0 |        | 0  sy 0  0 |
    | 0 0 1 tz |         | -sinθ 0 cosθ 0 |        | 0  0  sz 0 |
    | 0 0 0 1  |         |   0   0  0   1 |        | 0  0  0  1 |
```

The aircraft uses Euler order **YXZ** (yaw, then pitch, then roll), the same order a pilot thinks in.

### 10.2 Aircraft animation along a curve

```
for every frame:
    phaseTime += dt × simulationSpeed
    if phaseTime ≥ phase.duration: move to next phase
    t = phaseTime / duration                 // 0..1
    u = ease(t)                              // e.g. t² for constant acceleration
    position = curve.getPointAt(u)           // translation
    T = curve.getTangentAt(u)                // unit direction of motion
    heading = atan2(T.x, T.z)                // yaw
    pitch   = asin(T.y) + extraPitch(t)      // climb angle + rotation/flare
    speed   = |position - lastPosition| / dt
    bank    = atan(speed × yawRate / g)      // coordinated-turn formula, clamped to ±25°
    aircraft.rotation = (-pitch, heading, bank)
```

Takeoff uses `u = t²` (from `s = ½at²`, constant acceleration); the landing rollout uses `u = 1 − (1 − t)²`
(constant deceleration); taxi segments use smoothstep `u = 3t² − 2t³` to start and stop gently.

### 10.3 Bézier curves

Cubic Bézier curve with control points P0..P3 (used for liftoff, the 180° turn, the base turn and the flare):

```
B(t) = (1−t)³P0 + 3(1−t)²t·P1 + 3(1−t)t²·P2 + t³·P3,   0 ≤ t ≤ 1
```

The curve starts along P0→P1 and ends along P2→P3, so choosing control points in line with the previous
and next straight segments makes the motion continuous.

### 10.4 Catmull-Rom spline

Used for the taxi route back to the hangar and for the vehicle loops. The curve passes **through** every
control point, which makes it easy to lay a path along the taxiways. Arc-length parametrisation
(`getPointAt`) keeps the speed constant.

### 10.5 Follow (chase) camera

```
offset_world = Ry(aircraftHeading) · (0, 7, −32)       // local offset → world
desired      = aircraftPosition + offset_world
cameraPos    = lerp(cameraPos, desired, 1 − e^(−4·dt))  // smooth, frame-rate independent
camera.lookAt(aircraftPosition + (0, 3, 0))              // viewing transformation
```

### 10.6 Projection

Perspective projection maps the view frustum to the canonical view volume (f = cot(fov/2)):

```
P = | f/aspect  0      0                0            |
    | 0         f      0                0            |
    | 0         0   (far+near)/(near−far)  2·far·near/(near−far) |
    | 0         0     −1                0            |
```

Orthographic projection (Top view) maps a box `[l,r]×[b,t]×[n,f]` linearly and does not divide by
depth, so parallel lines stay parallel and sizes do not shrink with distance.

### 10.7 Clipping plane

```
Plane: n · p + d = 0,  n = (−1, 0, 0),  d = x0(t) = 70 + 75·sin(0.35t)
For each fragment p: if n · p + d < 0 → discard
```

The GPU clips primitives against the camera's six frustum planes. Three.js also skips any object whose
bounding sphere is entirely outside the frustum (frustum culling).

### 10.8 Day/night blending

```
night ∈ [0,1] moves toward target (0 or 1) at 0.8 per second
for every light/material:  value = lerp(dayValue, nightValue, night)
```

This blends the sun/moon intensity, colour and direction, the ambient light, the sky colours, fog colour,
star opacity, emissive lamp intensity, glow sprite opacity and spot-light intensity.

### 10.9 Flight model (Fly Yourself)

```
speed:     dV/dt = thrust*throttle − k*V²*(1 + flapDrag + gearDrag) − g*sin(pitch)     (in the air)
lift:      liftRatio = (V / (1.25*Vstall))² * cos(bank);  sink = (1 − liftRatio)*10 if liftRatio < 1
turning:   headingRate = g * tan(bank) / V                                          (coordinated turn)
controls:  q = q * rotation(localAxis, rate*dt)   for pitch (local X), roll (local Z), yaw (local Y)
position:  p = p + (forward*V − (0, sink, 0)) * dt
```

Two performance profiles share the same equations: a trainer for the SkyVision valley (lifts off at about
56 kt) and an A320-class airliner for Mumbai (lifts off at about 135 kt after roughly 1.1 km, approaches at
about 130 kt).

### 10.10 Landing judgement (inverse transformation)

```
local = R_y(−runway.rotation) · (aircraft.xz − runway.xz)     // world -> runway coordinates
onRunway = |local.x| ≤ width/2  and  |local.z| ≤ length/2
touchdown rate = −verticalSpeed × 196.85 ft/min
score = 100 − rate penalty − centreline offset − misalignment − late/short touchdown  -> 1..5 stars
crash if: gear up, > 900 ft/min, wing strike (bank > 15°), nose-first, off-runway at speed, water, building
```

### 10.11 Real-world data pipeline (Mumbai)

```
1. Download OpenStreetMap features (Overpass API) and elevation tiles (AWS Terrain Tiles, zoom 12)
2. Project every latitude/longitude:  x = (lon − lon0)·111320·cos(lat0),  z = −(lat − lat0)·110574
3. Decode elevation PNG pixels:  h = R·256 + G + B/256 − 32768   and resample to a 60 m grid (bilinear)
4. Flatten each airport polygon to its elevation, blending back to natural ground over 400 m (smoothstep)
5. Runways: centreline way -> centre, length, heading -> rotation, runway numbers from the heading
6. Aprons: stitch split outlines into closed rings; buildings: footprint + height; stands: stop point + heading
7. Save compact files: JSON (airports, runways, taxiways ...) + Int16 binary grids (terrain, 126k buildings)
```

At runtime the height grid becomes a triangle mesh (every 2nd sample = 120 m), taxiway centrelines become
ribbons (each point offset sideways along the perpendicular), apron polygons are triangulated, and
terminal footprints are extruded upwards.

### 10.12 Autopilot and autoland

```
heading  -> bank:     targetBank = clamp(1.6 × (heading − desiredHeading), ±25°);  roll = 3 × (targetBank − bank)
altitude -> pitch:    desiredVS  = clamp((targetAlt − alt) / 10 s, ±maxClimb);    pitch = asin(desiredVS / speed)
speed    -> throttle: throttleRate = 0.25 × (targetSpeed − speed)

CRUISE:   fly to the intercept point on the chosen runway's extended centreline at a terrain-safe
          height, descending on a continuous 3.5° profile (holding near the fix if still too low)
APPROACH: desiredHeading = runwayCourse + clamp(lateralOffset / k, ±30°)          (like an ILS localizer)
          desiredVS = −speed × tan(3°) + (glidePathAlt − alt) / 6 s                (glide slope)
FLARE:    below ~14 m: desiredVS = −max(0.6, height × 0.2); throttle closed just before touchdown
ROLLOUT:  brakes on, nose-wheel steering holds the centreline until stopped
```

The runway end is chosen by cost = distance to its intercept point + (turn needed to join the course) ×
final-approach distance, so the aircraft lands on whichever end is most straight-in. In test flights on
every route (Mumbai to Navi Mumbai and back, and all SkyVision routes), the autopilot lands at
140–200 ft/min on the centreline.

### 10.13 GPU instancing

```
for each copy i:  M_i = T(position_i) · R_y(heading_i) · S(width_i, height_i, depth_i)
InstancedMesh(geometry, material, count).setMatrixAt(i, M_i)   -> one draw call for all copies
```

The vertex shader multiplies each vertex by its instance's matrix, so 126,000 buildings cost a few dozen
draw calls instead of 126,000. Parked aircraft are "baked" first: every mesh of one aircraft is transformed
into aircraft space and merged per material, then instanced once per airline.

## 11. Implementation

1. **Scene setup:** renderer with shadows and tone mapping; scene graph with a `world` group.
2. **Airport modelling:** runway slab with separately translated markings; taxiways/apron; terminal
   (box + flattened half-cylinder roof + jet bridges); tower (stacked cylinders, octagonal glass cab,
   rotating radar); hangar (half-cylinder arch on walls); roads, car park with parked cars; signs, windsock,
   trees and hills.
3. **Aircraft modelling:** fuselage cylinder, scaled-sphere nose, cone tail, extruded wing/stabiliser/fin
   shapes (mirrored for the right side), engines, retractable gear, navigation/beacon/strobe lights and a
   landing spotlight.
4. **Flight animation:** ten phases described as data in `FlightPath.js`; `FlightController.js` evaluates
   the current curve and writes position and orientation.
5. **Vehicles:** bus, fuel truck and baggage tug with two carts; closed Catmull-Rom loops; carts follow at a
   fixed distance behind the tug.
6. **Cameras:** Top (orthographic), Airport (fixed), Follow (chase), Tower (tracks aircraft and zooms by
   changing FOV), Free (WASD + mouse).
7. **Lighting:** hemisphere + directional light with shadow map; gradient sky shader; stars; night lights
   registered in `LightRegistry` and blended by `LightingManager`.
8. **UI:** main menu, controls screen, pause menu, exit screen, HUD with camera/mode/flight
   phase/animation status and telemetry, toast messages.
9. **Extras for demonstration:** clipping plane (K), wireframe (F), animation speed (+/−), screenshot (O).
10. **Fly Yourself:** flight model, autopilot with automatic landing (P), missions, touchdown scoring and crash rules, flight assist, five flight
    cameras (chase, cockpit, orbit, tower, map), canvas instruments (compass, attitude indicator, minimap),
    PAPI lights, target beacon, procedural engine sound, tyre smoke and explosion particles.
11. **SkyVision valley:** fractal-noise terrain with a lake, instanced forests and a town, and two extra
    airfields with approach corridors cut through the hills.
13. **Phones and tablets:** detected with the `(pointer: coarse)` media query. On-screen virtual joystick,
    throttle slider and AP / gear / flaps / brake / camera / day-night / pause buttons (Pointer Events, so
    one code path handles touch and mouse), a compact HUD, a rotate prompt in portrait, fullscreen and
    landscape lock on Android, a web app manifest (installable, opens fullscreen in landscape), and a lower
    render resolution and shadow-map size for mobile GPUs.
12. **Mumbai region:** data build tool, real terrain and coastline, sea, 5,350 major roads (bridges raised
    above the water), 126k instanced buildings with lit windows at night, CSMIA / Navi Mumbai / Juhu with
    real runways, taxiways, aprons, terminals, hangars and jet bridges, auto-placed control towers, apron
    floodlights, and an instanced parked fleet in Indian airline colour schemes (IndiGo, Air India, Akasa Air,
    SpiceJet, Air India Express), selectable for your own aircraft.

## 12. Screenshots

Press **O** inside the simulation to save a PNG, then insert the images here:

| # | Screenshot | What it shows |
|---|---|---|
| 1 | Main menu | UI, menu over orbiting camera |
| 2 | Airport view (day) | Complete airport, aircraft at hangar |
| 3 | Top view | Orthographic projection of the layout |
| 4 | Follow camera, takeoff | Pitch rotation during liftoff |
| 5 | Follow camera, turn | Bank (roll) during the turn |
| 6 | Tower camera | Viewing transformation tracking the aircraft |
| 7 | Night mode, final approach | Runway/approach lights, landing light, stars |
| 8 | Clipping plane | Part of the scene clipped away |
| 9 | Wireframe mode | Polygon structure of the models |
| 10 | Mission select | Airline picker, Mumbai and SkyVision missions |
| 11 | Mumbai from the air | CSMIA's crossing runways, Terminal 2 and the city |
| 12 | Terminal 2 close-up | Real footprint, parked fleet in airline colours, jet bridges |
| 13 | Mumbai at night | Lit city, road network, runway and approach lights |
| 14 | Final approach, Navi Mumbai | Chase camera, HUD instruments, PAPI |
| 15 | Landing report | Star rating and touchdown statistics |

## 13. Results

- The complete ten-phase flight runs automatically in about 110 seconds at 1× speed and can be
  paused, reset, sped up (up to 4×) or slowed down (0.5×).
- All five camera modes switch instantly and correctly show projection and viewing concepts.
- Day/night switches with a smooth ~1.25 s transition; over 130 lamp fixtures, 3 floodlights, the hangar light
  and the aircraft landing light respond.
- The scene runs at interactive frame rates on integrated laptop graphics.
- No external 3D model or image files are used; every object and texture is generated in code.
- Fly Yourself: scripted test flights land at every runway end with 4–5★ when flown with good technique;
  hard, misaligned or off-runway landings are scored down or end in a crash.
- Mumbai region: builds in a few seconds from about 2.4 MB of pre-processed data. It has 5 runways at 3
  airports (09/27 and 14/32 crossing at CSMIA), 503 taxiways, 179 stands and about 126,000 buildings.

## 14. Advantages

- Every graphics concept is visible and traceable to a small, readable function.
- Runs in any modern browser with no installation for the viewer, and works offline.
- Modular architecture: each part of the airport or system is an independent file.
- Lightweight: primitives + procedural textures keep memory and GPU load low.
- Interactive demonstrations (clipping, wireframe, projections) make the viva straightforward.

## 15. Limitations

- The autopilot demo follows predefined curves, and the Fly Yourself flight model is simplified (no wind,
  weight, engine failure or real aerodynamic coefficients).
- Vehicles follow fixed loops and do not detect collisions; the player's aircraft does not collide with
  parked aircraft.
- Models are stylised primitives, not detailed meshes. The Mumbai terminals are extruded footprints with
  flat roofs, and city buildings are boxes from OpenStreetMap bounding boxes (heights are estimated where
  the map has none).
- The Mumbai data is only as complete as OpenStreetMap: missing aprons are filled with generated stand pads,
  and there is no mapped control tower at CSMIA or Navi Mumbai, so towers are placed automatically.
- The elevation data is about 38 m resolution, so small hills and embankments are smoothed.
- Shadows are cast only within about 230 m of the focus point (limited shadow-camera size).

## 16. Future Scope

- Multiple aircraft with simple scheduling (one lands while another waits).
- Weather effects: rain particles, fog density control, clouds.
- Loading detailed glTF models while keeping primitive fall-backs.
- Post-processing: bloom for lights, screen-space ambient occlusion.
- More real airports (e.g. Delhi, Bengaluru) using the same data pipeline, with a scaled "long haul" mode.
- AI traffic taking off and landing, and wind affecting the approach.
- Joystick/gamepad support through the Gamepad API.
- VR viewing through WebXR.

## 17. Conclusion

SkyVision shows that a small, well-structured project can bring together the core topics of a
Computer Graphics syllabus in one polished, interactive application. Geometric transformations
animate the aircraft and vehicles; hierarchical modelling builds complex objects from primitives;
perspective and orthographic projections with several viewing transformations let the user explore the scene;
curves drive smooth animation; a lighting model with shadows gives a convincing day/night cycle; and
clipping is demonstrated live. The project is stable, runs on ordinary hardware, and each feature
maps to a specific graphics concept that can be explained in the viva.
