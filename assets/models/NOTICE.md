# Aircraft models: credits and licence

The detailed aircraft models in this folder are **converted from FlightGear aircraft**. FlightGear is an
open-source flight simulator. The models are licensed under the **GNU General Public License, version 2**
(GPL-2.0, https://www.gnu.org/licenses/old-licenses/gpl-2.0.html). This folder and its contents are
distributed under the same licence.

| Folder | Source | Files used |
|---|---|---|
| `a320/` | Airbus A320 family for FlightGear, https://github.com/legoboyvdlp/A320-family (branch `dev`) | `Models/Fuselage/res/A320-216.ac`, `CFMLEAP1A.ac`, `Fuse-Main.png`, `Static-Elements.png`, `LandingGears.png`, `Models/Liveries/CFM-NEO/2k/CFM-LEAP-white.png` |
| `a350/` | Airbus A350 family for FlightGear, https://github.com/ImFrustrated45/A350-Family (branch `main`) | `Models/A350-900.ac`, `wings.png`, `landinggear.png`, `a350xwb.png` |
| `a380/` | Airbus A380 for FlightGear (Omega Hangar), https://github.com/FGMEMBERS/A380-omega (branch `master`) | `Models/a380.ac`, `trent900.ac`, `Models/Liveries/blank.png`, `wing.png`, `tail.png`, `extra.png`, `landing-gears.png`, `rr_fan.png` |

The original authors are credited in each repository.

## Modifications

The conversion is done by `tools/convert-aircraft.mjs` (with `tools/ac3d.mjs`):
- The AC3D files are converted to glTF binary (`model.glb`). Cockpit interiors, alternative parts and
  duplicates are left out. Vertex normals are computed, and parts are merged per material.
- Geometry is moved into SkyVision's coordinate frame, with the origin on the ground under the main gear.
- Textures larger than 2048 px are downscaled.
- The `*.cat.png` and `*.pos.png` helper images are generated for repainting.
- At runtime, `js/aircraft/LiveryPainter.js` repaints the original textures. It removes the original
  titles, logos and primer, and applies SkyVision's own simplified airline colour schemes.

To rebuild from the original files, place them in `tools/.cache/fg/<type>/` and run:

    node tools/convert-aircraft.mjs

The airline colour schemes are simplified approximations for an educational, non-commercial project. No
airline logos are reproduced, and the project is not affiliated with Airbus or with any airline.
