# Rendering mistakes that drew the wrong map

references/pitfalls.md is about numbers that lied. This file is about pictures
that lied: renderers that passed `bin/mfs test` and their bench checks while
drawing the wrong map. Every entry happened in this repository; the ids point
to the examples and their fix commits. Most were found by the review passes of
2026-10-30, which opened every page and looked at it
(`.agents/skills/visual-review` has that procedure).

Each entry: what the screen showed, why, how to test for it, how it was
fixed. "Repeated" means the same mistake in more than one example. A section
marked **not yet seen** has no case here yet; it lists what to look at, not
what went wrong.

## World wrapping

### Land drawn once (repeated: maplibre 010, 012, 013, 061, 070, 073; mapbox 127)

- Screen: Alaska or Chukotka ends in a straight vertical edge at 180°; the
  far side of the Pacific is empty. At the opening zoom of 061, 070, 073 and
  127 the view is wider than one world or crosses 180°.
- Why: the Canvas 2D examples were copied from one template that loops over
  the polygons once. 069 had the repeat; its copies did not.
- Test: open at zoom 2 to 3, pan across 180°, and look for land with a
  vertical edge.
- Fix: loop `wrap` from `floor(centerX − width / (2·scale))` to
  `floor(centerX + width / (2·scale))` and shift x by `wrap·scale` (as 069).
  The stroke along the 180° cut stays as a faint seam; leave it out of the
  stroke where it matters.
- Lesson: when a fix lands in one example, grep for the template's loop in
  the others (`originX + ring` found all seven).

## Projection

### An axis factor applied twice (25)

- Screen: Akita at 0.64 of its east-west width (drawn 2.6 times taller than
  wide; the ground ratio is about 1.6).
- Why: the shader multiplied x by `GEO_ASPECT` (0.64) and then, in the
  wide-screen branch, divided by `screenAspect / GEO_ASPECT`. The hover
  inverse and the bench read-back coordinates were written against the same
  output, so picking and checks still passed.
- Test: the drawn bounding box's width over height against the ground ratio
  (km east-west over km north-south).
- Fix: apply the geographic aspect once, then undo only the screen aspect;
  move the inverse and the check coordinates with it.

### Baked units mistaken for degrees (forge3d 004, during its fix)

- Screen: a blank map; the camera went to zoom 15 near 0°, 0°.
- Why: the new fit-to-bounds code read the baked boundary as lon/lat, but the
  bake had already projected it to Web Mercator 0..1.
- Test: print a few baked coordinates before writing code that consumes
  them; `bake.ts` says the units.

### Nearest-cell sampling is a choice, not a bug (d3 016)

The staircase on its contour bands comes from `texelFetch` without
interpolation, and REQUEST.md says so. Read REQUEST.md before reporting.

## Interaction

### Dragging moves the map the wrong way (deckgl 019)

- Screen: dragging down moved the ground up.
- Why: the pan formula was written for the camera before its fix (see
  Terrain); when the eye moved to the other side of the target, the sign of
  the vertical term had to change too.
- Test: after any change to a camera, drag a synthetic pointer down and right
  and check that a recognisable feature moved down and right.
- Fix: `east = −dx·cos b + dy·sin b`, `north = dx·sin b + dy·cos b` for
  bearing b clockwise from north.

Seen once so far.

## Picking

### The inverse shares the forward mistake (25)

The hover inverse repeated the double aspect factor of the projection, so the
picked bear was the one under the cursor on the squashed map. A pick that
agrees with the drawing proves only that the two match. Test picking against
known data: hover the projected position of a record taken from the data, and
expect that record.

### A pick pass that shares the vertex shader is fixed with it (deckgl 007)

007 draws ids into an offscreen framebuffer with the same vertex shader, so
fixing the extrusion sign fixed picking too. Prefer this to a separate CPU
inverse.

### Suspected, not confirmed: the nearest centre instead of the circle under the cursor (07)

Hovering the middle of Tokyo's large circle reported Yokohama. If the pick
takes the nearest centre within a radius rather than the largest circle
containing the cursor, small neighbours win inside big circles. Check before
relying on it.

## Popup

**Not yet seen.** Look at: the anchor staying on its coordinate during pan and
zoom (073, 127, leaflet 005 draw popups on the canvas); popups near the edge
of the screen; a popup on the far side of 180°.

## Markers

### A legend that drifts from the data (openglobus 004)

- Screen: five billboards on the map, three in the legend.
- Why: the legend was written by hand in `index.html`; the bake listed five.
- Fix: build the legend from the data the renderer draws, or check the counts.

Marker anchoring itself (the tip on the coordinate) was right in every
example checked (010, 009, 213, 244 not yet).

## Clustering

**Not yet seen.** 056's clusters overlap heavily at zoom 3 (radius by count up
to 40 px with a 50 px cluster radius); MapLibre's own example overlaps as
well, so it was not judged a bug. Look at: counts that add up to the number of
points, clusters splitting when zooming in, a cluster's position against its
members.

## KDE / heatmap

**Not yet seen.** 011 and maplibre 053 were not reviewed for this. Look at:
the kernel radius in screen pixels versus metres when zooming, intensity
saturating to one colour in dense areas, the colour ramp's zero being
transparent.

## Terrain

### Sea level read as land (21)

- Screen: the whole ocean in the lowland green.
- Why: Mapterhorn has no bathymetry, so the sea is exactly 0 m, and the shader
  coloured only `h < 0` as water. Also `texelFetch(...).rgb * 255.0` is not an
  integer (128 can come back as 128.00002), so 0 m decoded as about +0.005 m.
- Test: decode a known ocean tile on the CPU and count values below, at and
  above zero (3/7/3: 258,667 of 262,144 pixels at exactly 0).
- Fix: `floor(rgb * 255.0 + 0.5)` before Terrarium decoding; `h <= 0` is sea.

### An upside-down camera (deckgl 019)

- Screen: Mount St. Helens as a funnel, the void at the bottom of the screen.
- Why: the eye stood on the bearing side of the target while `right` pointed
  for the opposite view, so `up = right × forward` pointed down.
- Test: assert `up.z > 0`; the sky must be at the top.
- Fix: the eye opposite the bearing (deck.gl: bearing 0 looks north).

### Gaps between levels of detail (17, recorded in REQUEST.md)

The first version put every vertex at a sample centre, which left a groove of
half a sample (7.8 m between L0 and L1) that skirts could not hide from
above. Edge vertices were moved onto the chunk frame.

### A contour band that looked like a bug (17)

A brown rectangle around Fuji at the opening pitch was the 1,400 to 1,600 m
band in perspective; from straight above it is round. Change the view before
calling a shape wrong.

## 3D extrusion

### Blocks extruded into the ground (deckgl 007)

- Screen: tall blocks hung below Vancouver's southern shore.
- Why: the orthographic camera had `screen.y = r.y·sinφ − z·cosφ` and
  `depth = −r.y·cosφ − z·sinφ`: the city seen from under the ground.
- Rule (φ the elevation angle, 90° straight down; r.y towards the far side):
  `screen.y = r.y·sinφ + z·cosφ`, `depth = r.y·cosφ − z·sinφ`.
- Test: no extrusion below the footprint's near outline; the tallest feature
  rises towards the top of the screen.

012 (hexagons) and 025 (trips) use the tilt-from-vertical convention with a
y-down screen and were right; compare conventions before copying a formula
between examples.

## Globe occlusion

### Flat triangles folding over the horizon (repeated: cesium 180, 213)

- Screen: northern Eurasia spread over the Arctic as a wedge with straight
  edges (213's opening view; 180 at other angles).
- Why: Natural Earth 110m triangulated by earcut in lon/lat gives triangles
  tens of degrees wide. Projected from three corners and filled flat, a corner
  behind the horizon lands inside the disc and the triangle folds back.
  Culling only triangles with all three corners behind does not help.
- Test: rotate so a large landmass sits on the rim (pitch ±1.1).
- Fix: split once at load to edges of at most 20°, keep unit-sphere xyz, move
  far corners of horizon triangles onto the rim, fill everything as one path.
  4,758 → 10,263 triangles, and one path redrew faster than the separate
  fills (32.6 against 37.9 ms p50 with a GPU read-back in Chrome on a Mac);
  6° (30,072 triangles) was four times slower, and splitting at bake time
  cost 67 KB gzip already at 12°.
- 180 was copied from the same code; 244 (points on a globe) has not been
  checked for it.

## Cartographic layout

### A fixed opening zoom that does not fit (forge3d 004)

At zoom 10 Luxembourg is 827 px tall, so its northern and southern lines were
cut in an 800 px window. Fit the opening view to the data's bounds at load.

### Base data too coarse for the scale (tangram 004)

- Screen: no San Francisco Bay; coastal highways over the sea, at zoom 8 on
  Natural Earth 110m land.
- Rough limits for Natural Earth: 110m to about zoom 3, 50m to about 5, 10m to
  about 8 to 9; beyond that, OpenStreetMap-derived land.
- Fix within a 45 KB data budget: keep world 110m for zooming out, cut 10m
  countries to the opening view plus a margin, fill that box with the sea
  colour, clip to it and draw the 10m land. 110m needs only 4 decimals in
  Mercator units, which saved 6.3 KB, more than the 5.0 KB the detail cost.
- Test: overlay the line data and look for lines over water.

The template examples draw 110m land at their opening zooms too; 009
(Copenhagen at zoom 8) shows the same mismatch on its coasts.

## Outside the twelve

### Range retries that defeat the CDN (10, 18, 24)

The Cloudflare front of z.yuiseki.net answers the first request for a URL
with 200 and later ones with 206. Retrying with `?retry=N` made every attempt
a first request, so 10 never loaded. Cancel the 200 body and retry the same
URL. Check each host: Mapterhorn's answered 206 from the first request.

### Dev server MIME types (22)

`WebAssembly.compileStreaming` refuses anything but `application/wasm`; only
local runs showed the error. Fixed in `harness/lib/serve.ts`.

### A correctness fix against a size budget (cesium 213)

`code_gzip_bytes` is the sum of per-file gzip, comments included, and
copy-pasted code compresses well: replacing three repeated vertex blocks with
a loop and a helper still added about 300 B. 213's budget moved from 3,500 to
3,700 B with the reason in `spec.yaml`. A wrong map within budget is not a
pass.
