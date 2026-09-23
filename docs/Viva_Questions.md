# SkyVision: Viva Questions and Answers

Short answers you can say in your own words. Where useful, the answer names the file to open during the
demo.

---

### 1. Why did you choose this project?
An airport has everything a CG syllabus covers in one scene: 3D models, moving objects that need
translation and rotation, several useful camera viewpoints, and a natural reason for day/night lighting.
It is visually interesting, but the math stays simple enough to explain line by line.

### 2. What is Computer Graphics?
Computer Graphics is creating, storing and manipulating images and models of objects with a computer.
In 3D graphics we describe objects with geometry (vertices and polygons), transform them into a camera's
view, project them onto a 2D screen and colour each pixel using lighting and textures.

### 3. Where is translation used?
Moving the aircraft along its path every frame (`root.position = curve.getPointAt(u)` in
`FlightController.js`), moving the vehicles (`VehicleManager.js`), and placing repeated objects such as runway
dashes, lights and trees at different positions (`Runway.js`, `Environment.js`).

### 4. Where is rotation used?
- Aircraft **yaw** (heading from the path direction), **pitch** (nose up on takeoff, flare on landing) and
  **roll/bank** (tilting in turns): `root.rotation.set(-pitch, heading, bank)`.
- Landing gear folds up by rotating 90° about the X axis.
- The radar on the tower rotates continuously about Y.
- Vehicles rotate to face their direction of travel.
- The ground plane is rotated −90° about X to lie flat.

### 5. Where is scaling used?
The nose cone is a sphere stretched 1.9× along Z. The terminal and hangar roofs are half-cylinders flattened with non-uniform scaling, the parked gate aircraft
are the same model scaled to 0.85, the Mumbai airliners are scaled to 1.4 (A320 size) or 1.95 (wide-body),
every city building is a unit box scaled to its width × height × depth, and trees get random scale. The right wing is the left wing
with `scale.x = −1`, which is a **reflection**.

### 6. What is perspective projection?
A projection where lines of sight meet at one point (the eye/centre of projection). Distant objects
appear smaller and parallel lines converge toward vanishing points. It is defined by a field of view,
aspect ratio and near/far planes, forming a viewing **frustum**.

### 7. Why use perspective projection?
It matches how human eyes and real cameras see, so the scene looks realistic and depth is easy to judge.
We also use **orthographic** (parallel) projection for the Top view, where no size change with distance
is wanted. It works like a map, useful for seeing the whole layout. Pressing `1` and `2` shows the difference.

### 8. What is a viewing transformation?
The transformation from world coordinates to camera (eye) coordinates. It places the camera at the
origin looking down −Z. `camera.lookAt(target)` builds this **view matrix** from the camera position, the
target point and an "up" vector. The follow and tower cameras recompute it every frame.

### 9. What is clipping?
Removing the parts of primitives that lie outside a region so they are not drawn. The GPU clips
everything against the camera's view volume (six planes including near and far). Press `K` to see an extra
clipping plane `n·p + d = 0` sweep across the airport; every fragment on one side is discarded. Three.js
also does frustum culling, skipping objects completely outside the view.

### 10. How is aircraft animation implemented?
The flight is a list of ten phases in `FlightPath.js`. Each moving phase has a curve (line, Bézier or
Catmull-Rom spline) and a duration. Each frame we convert elapsed time into a fraction `t`, apply an easing
function (for example `t²` for constant acceleration on the takeoff roll), then read the position and
tangent from the curve. The tangent gives heading and climb angle; the turn rate gives the bank angle.

### 11. How does the camera work?
There are two cameras: a perspective camera and an orthographic camera. `CameraManager.js` places them for
five modes: Top (orthographic, from above), Airport (fixed cinematic), Follow (behind the aircraft, using
an offset rotated by the aircraft's heading and smoothed with interpolation), Tower (fixed eye in the
tower, looks at the aircraft and narrows the FOV to zoom), and Free (W/A/S/D + mouse drag).

### 12. How is lighting implemented?
A hemisphere light gives ambient light (sky colour from above, ground colour from below). A directional
light is the sun by day and the moon by night, and casts shadows with shadow mapping. At night, spot lights
(apron floodlights, aircraft landing light) and a point light (hangar) turn on, and lamp materials become
emissive with glow sprites. One value `night` from 0 to 1 blends all intensities and colours, so the switch
is smooth.

### 13. How is the aircraft model created?
It is built in code from the real dimensions of the A320, A350 and A380 (`AircraftTypes.js`), with no 3D
model files. The **fuselage** is a set of cross-section rings along the body: the radius grows at the nose,
stays constant along the cabin, and the belly sweeps up into the tail cone. Neighbouring rings are joined
with triangles, and each vertex gets a UV coordinate (along, around) so the livery can be wrapped onto it.
The **wings, stabilisers and fin** are an airfoil cross-section **lofted** through root, kink and tip
stations, with the winglet (A320 sharklet, A350 curved tip, A380 fence) as extra stations. The right wing is
the left wing mirrored (`scale.x = −1`). The **engine nacelles** are a 2D profile turned 360° with
`LatheGeometry`. The **landing gear** has 2, 4 or 6-wheel bogies. All parts are children of one `root`
group (hierarchical modelling), so moving the root moves the whole aircraft.

### 14. What coordinate system are you using?
A right-handed 3D Cartesian system: +X east, +Y up, +Z south (so north is −Z), units in metres.
Each model also has its own **local** coordinate system (the aircraft's nose points +Z locally).
Vertices go local → world → camera → clip → normalised device → screen coordinates.

### 15. What is the difference between 2D and 3D transformations?
2D transformations act on (x, y) and use 3×3 homogeneous matrices; rotation is about a single point.
3D transformations act on (x, y, z) and use 4×4 homogeneous matrices; rotation is about an axis (X, Y
or Z), and there is a third translation and scale component. In 3D the order of rotations also matters
(we use yaw → pitch → roll).

### 16. What algorithms/concepts are used?
Composite transformation matrices (T·R·S) and hierarchical modelling; perspective and orthographic
projection; the lookAt viewing transformation; Bézier and Catmull-Rom curves with arc-length
parametrisation; easing-based kinematics; z-buffer hidden-surface removal and back-face culling; plane
clipping and frustum culling; Lambert/PBR shading; shadow mapping; texture mapping; additive blending; fog;
linear interpolation for day/night.

### 17. What are the limitations of your project?
The autopilot demo follows predefined curves and the Fly Yourself flight model is simplified (no wind or
detailed aerodynamics). Vehicles follow fixed loops without collision detection, and the models are stylised.
The Mumbai buildings are boxes from map outlines with estimated heights where the map has none, and the
map data has gaps (missing aprons are filled in, towers are auto-placed). Shadows only cover a small area
around the aircraft.

---

## Extra questions examiners often ask

**Q. What is homogeneous coordinates and why use 4×4 matrices?**
A 3D point (x, y, z) is written as (x, y, z, 1). This lets translation, which is not a linear
operation in 3D, be written as a matrix multiplication, so any chain of transformations combines into one
matrix.

**Q. Does the order of transformations matter?**
Yes, matrix multiplication is not commutative. Rotating then translating is different from translating
then rotating. Three.js uses `T · R · S`: scale first, then rotate, then translate.

**Q. What is the z-buffer?**
A per-pixel depth buffer. When drawing a fragment, its depth is compared with the stored depth; it is
drawn only if it is closer. This removes hidden surfaces regardless of drawing order.

**Q. What are the near and far clipping planes?**
The closest and farthest distances the camera renders (0.3 m, and 14 km in the valley / 60 km over
Mumbai). Anything outside is clipped. A huge far/near ratio would normally ruin depth-buffer precision,
so we use a **logarithmic depth buffer**, which spreads precision evenly over distance.

**Q. What is a Bézier curve?**
A parametric curve defined by control points. A cubic Bézier uses four:
`B(t) = (1−t)³P0 + 3(1−t)²tP1 + 3(1−t)t²P2 + t³P3`. It starts at P0 heading toward P1 and ends at P3
coming from P2. We use it for the takeoff, the 180° turn and the landing flare.

**Q. How did you make the animation independent of frame rate?**
Every update uses the real time elapsed since the last frame (`dt`), so a slower computer shows fewer
frames but the aircraft still takes the same time to complete the flight.

**Q. What is texture mapping? Did you use image files?**
Mapping a 2D image onto a 3D surface using UV coordinates. We generate all textures in code on an HTML
canvas (grass, asphalt, terminal windows, signs, runway numbers), so no image files are needed.

**Q. What is shading? Which model do you use?**
Shading computes a surface's colour from lights, surface normal and material. We use Three.js's
`MeshStandardMaterial` (physically based: Lambert diffuse plus a specular term controlled by roughness and
metalness), evaluated per pixel.

**Q. How are shadows produced?**
Shadow mapping. The scene is first rendered from the sun's point of view into a depth texture. When
drawing each pixel, its distance to the sun is compared with the stored depth; if something closer blocks
the sun, the pixel is in shadow.

**Q. Why WebGL/Three.js instead of OpenGL in C++?**
WebGL is OpenGL ES in the browser, so it uses the same pipeline (vertex shader, rasterisation, fragment
shader, depth test). Three.js gives us the matrices, cameras and scene graph, but all modelling,
transformations, camera logic, animation and lighting design are our own code. It also runs on any laptop
without installing compilers or libraries.

**Q. What does the wireframe mode (F) show?**
The polygon (triangle) mesh of each model without filled faces, which shows that every object is made of
simple primitives.

---

## Fly Yourself and the Mumbai region

**Q. How does the player's aircraft fly? Is it real physics?**
It's a simplified flight model with real ideas behind it. Throttle gives thrust and drag grows with speed
squared, so there is a top speed. Lift grows with speed squared, so below about 1.25× stall speed the aircraft
starts to sink. Banking turns the aircraft (turn rate = g·tan(bank)/V). Climbing costs speed and diving gains
it. There's no wind or detailed aerodynamics.

**Q. Why quaternions for the player's aircraft but Euler angles for the demo?**
The player can roll and loop in any direction. Applying pitch, roll and yaw as small rotations about the
aircraft's own axes is easiest with quaternions (q = q × rotation), and they never suffer gimbal lock. The
demo aircraft only yaws, pitches a little and banks, so Euler angles are enough and easier to explain.

**Q. How do you know if the aircraft landed on the runway?**
With an inverse transformation. The runway was placed in the world by a rotation and a translation, so we
undo them: subtract the runway centre from the aircraft position, then rotate by minus the runway angle. In
that runway coordinate system the check is simply |x| ≤ width/2 and |z| ≤ length/2. The same local x gives
the centreline offset for the score.

**Q. How is the landing scored?**
From the touchdown rate in feet per minute (under 120 is a "butter" landing, over 900 is a crash), the
distance from the centreline, the angle to the runway, and where along the runway you touched down. The
score out of 100 becomes 1–5 stars.

**Q. What are the PAPI lights?**
Four lights beside the runway that show white or red depending on the angle from each light up to the
aircraft. Two white and two red means the aircraft is on the glide path (3° in Mumbai). We compute that
angle with atan2(height difference, horizontal distance).

**Q. Where does the Mumbai data come from? Is it real?**
Yes. The runways, taxiways, aprons, terminals, hangars, aircraft stands, jet bridges, roads and about 126,000
building outlines come from OpenStreetMap, and the terrain and coastline come from public elevation data.
A Node.js script downloads it once and converts it into compact files, so the app runs offline.

**Q. How do you turn latitude and longitude into 3D coordinates?**
With a map projection. Near one reference point (the origin), one degree of latitude is about 110.6 km and
one degree of longitude is about 111.3 km × cos(latitude). So x = (lon − lon0) × 111320 × cos(lat0) and
z = −(lat − lat0) × 110574. Over a 37 km region the error is negligible.

**Q. How is the terrain made from elevation data?**
The elevation tiles are PNG images where each pixel's colour encodes a height:
h = R×256 + G + B/256 − 32768. We sample them on a 60 m grid, make a triangle mesh from every 2nd sample (two
triangles per grid square), and use bilinear interpolation of the full grid for collision.

**Q. How can a laptop draw 126,000 buildings?**
With GPU instancing. All buildings share one box geometry and one material, and each copy has only its own
model matrix (translation × scale). The whole set goes to the GPU in a few draw calls instead of 126,000. The
city is also split into chunks, so off-screen chunks are skipped (frustum culling).

**Q. How are the terminals built?**
Their real outlines from OpenStreetMap are 2D polygons. We extrude them upwards (ExtrudeGeometry) to the
building height, giving walls and a roof. The walls get a glass-facade texture and the roof a plain material.
Apron outlines are triangulated into flat surfaces.

**Q. How do the crossing runways at Mumbai work in your model?**
Each runway is built along its own local axis and then rotated to its real heading: about 91° for 09/27 and
46° for 14/32. Where they overlap, the shorter one is raised by 4 cm so the two surfaces don't flicker
(z-fighting). You can land on either runway in either direction, and the report says which runway you used.

**Q. Are the airline liveries official?**
No. They are simplified colour schemes (tail, engines, cheatline and the airline name) inspired by Indian
airlines, used for an educational, non-commercial project. No logos are reproduced.

**Q. How is the livery painted on the aircraft?**
With texture mapping. A 2048 × 512 canvas is drawn in code: the base colour, the cheatline, every passenger
window (one or two decks, skipping the doors), door outlines, cockpit windows and the airline title. The
fuselage's UV coordinates map the canvas onto it, with u along the body and v around it. A second canvas holds
only the lit windows and is used as the **emissive map**, so the cabin windows glow at night.

**Q. How does the aircraft find its way to the gate after landing?**
The taxiways are a **graph**. Every point on a taxiway centreline is a node, and points shared by two
taxiways join them. The edges are weighted by length. After landing we pick the next runway exit ahead, run
**Dijkstra's shortest-path algorithm** from it, and choose the free stand that is cheapest to reach
(preferring stands with a jet bridge, and only stands wide enough for the wingspan). The aircraft follows the
route with **pure-pursuit steering**: it always steers towards a point a fixed distance further along the
path. It slows down before sharp turns and brakes so the nose wheel stops on the stand mark
(v² = 2·a·s).

**Q. How is the sound made? Are there audio files?**
No files: it uses the Web Audio API. The engine is low-passed noise (rumble), two slightly detuned sine tones
(fan whine; the small difference makes them "beat" like two engines), and a low hum. Their pitch and volume
follow N1, a value that lags behind the throttle the way a real turbofan spools up. Wind is band-passed
noise that grows with airspeed. On the runway there is a rumble plus a soft thump every 20 m (concrete
joints). On touchdown, a short noise burst sweeping down in pitch makes the tyre chirp, and a falling sine
makes the thud. Both are louder for a harder landing, and the camera shakes a little. The continuous sounds
pass through a compressor at a low master volume, so they stay in the background.

**Q. Why do the A350 and A380 need a longer runway?**
In the flight model the acceleration is thrust − drag − rolling friction, and heavier aircraft have less
thrust per kilogram, so they accelerate more slowly. They also need a higher speed to lift off
(liftoff ≈ 1.2 × stall speed). The measured takeoff rolls are about 1.1 km (A320), 1.45 km (A350) and 1.75 km
(A380), all shorter than Mumbai's 2.9 km and 3.5 km runways.

**Q. Can it run on a phone? How do the touch controls work?**
Yes. It's a website (deployed on Vercel), so it runs in the phone's browser using the phone's GPU through
WebGL. On a touch screen an on-screen joystick appears. The finger's offset from the joystick centre,
divided by the ring radius, gives a value from −1 to 1 for pitch and roll, the same inputs the keyboard
produces. A throttle slider sets the power, and buttons trigger the autopilot, gear, flaps and brakes. To
keep the frame rate up on phones we render at a lower pixel ratio and use a smaller shadow map.
