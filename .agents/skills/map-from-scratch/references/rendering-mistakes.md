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

### Land drawn once (repeated: maplibre 010, 012, 013, 061, 070, 073; mapbox 127; opfs 001)

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
  the others. `originX + ring` found seven; a second pass on 2026-10-30 that
  listed every renderer drawing `polygons` without any wrap found seven more
  written differently (`w / 2 + (ring[i][0] - centerMx) * scale`, or a
  `Path2D` under `setTransform`): mapbox 009 and 018 (Alaska cut in the
  opening view of 018), leaflet 001 and 005, tangram 004, deckgl 006,
  maplibre 056. Search for the absence of the fix, not for one spelling of
  the bug.

### Data layers drawn once while the land repeats (repeated: maplibre 056; openglobus 050)

With the land repeated, the clusters still sat on one copy at zoom 0. Draw
every layer that has map positions per copy (for a WebGL layer, one draw per
copy with the centre shifted by whole worlds), and offset labels and hit
testing the same way.

050 had the same split in a later example: the land loop repeated, the three
points and their hit test did not, so the North America on the right of a
1920 px screen had no New York. One helper that returns the copy range, used
by land, points and the hit test, keeps them from drifting apart. A check
that centres the map on 180° and clicks one world east of a point catches it
at the 1024 px bench width, where one world fills the screen.

### A fixed number of copies (maplibre 053)

Land and heat were repeated for copies −1, 0 and 1 only. At its minimum zoom
of 1 one world is 512 px, so a 1920 px screen needs four. Compute the copy
range from the screen width, as above, never a constant.

### A ring around a pole cut at 180° (d3 005)

- Screen: Antarctica as two long wedges with sea between them and the bottom
  edge of an equirectangular map.
- Why: the bake unwrapped each ring's longitudes and cut it at every
  multiple of 360°. Antarctica's ring goes once around the pole, so unwrapped
  it ends 360° from where it starts; nothing closed it along the pole. And
  the last piece of a ring, which continues into the first, was kept as a
  separate ring: both closed with chords.
- Fix: rotate the ring to start at its jump across 180° (or the seam lands
  where the data happens to start, 59° W here), add the two pole vertices
  when the unwrapped ring ends 360° away, and join the last piece to the
  first when they fall in the same copy of the world.
- Its `antimeridian-clean` check looked at Alaska and Chukotka only and
  passed with the wedges on screen; it now also needs land next to the pole.

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

### A fixed backing store stretched by CSS (opfs 001)

- Screen: the world twice as wide as tall at 1920x1021; Antarctica a band
  across the bottom third.
- Why: `<canvas width="1024" height="768">` with `width: 100%; height: 100%`
  in CSS. The square tiles were drawn square in a 1024x768 bitmap and the
  browser stretched it 1.875 times across and 1.33 times down. The bench
  viewport is 1024x768, so every check passed.
- Test: `canvas.width === round(clientWidth·dpr)` and the same for height
  (`square-tiles-and-world-copies`), and look at the page at a size other
  than the bench viewport.
- Fix: size the backing store from `clientWidth·dpr` on load and on resize,
  draw in CSS px under `setTransform(dpr, …)`.
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

### Wheel zoom about the screen centre (repeated: 23 flat 2D examples; opfs 001)

- Screen: the place under the pointer slides away while zooming; MapLibre,
  Leaflet and Mapbox keep it under the pointer.
- Why: the Canvas 2D templates called `setZoom(zoom ± d)` without the
  pointer position: forge3d 004, 008 and 010, mapbox 009, 018 and 127, all
  nine maplibre examples (053 included), openglobus 002, 004 and 009, tangram
  001, 004 and 010, deckgl 016, leaflet 001 and 005. 04, 07, 10, 19, 20, 24,
  26 and the other deckgl examples did it right.
- Fix (2026-10-30, all 23; openglobus 009, d3 019 and mapbox 045 in 19dc81b
  with a wheel-zoom-keeps-point bench check): move the point under the pointer to the centre,
  zoom, and move it back at the new scale. With a `panBy(dx, dy)` that moves
  the content by pixels, that is `panBy(−o); setZoom(z); panBy(o)` for the
  pointer's offset o from the centre; forge3d 010, which scales a plate
  about its centre, sets `pan = o − (o − pan) · z′ / z`.
- Test without knowing the page's API: grab the canvas, wheel at a point p
  off centre, grab again, and compare the two hypotheses "scaled about p"
  and "scaled about the centre" by the mean difference of sampled pixels.
  Put p on detail: on a uniform area both hypotheses score zero.

### Click tolerance (leaflet 001 and 005, 19, 20, 056)

A move of one pixel between `pointerdown` and `pointerup` turned a click into
a drag in leaflet 005 and 19, so popups and selections needed a perfectly
still hand (and failed on touch). leaflet 001, 20 and 056 had a tolerance but
compared each move event alone, so a slow drag of 1 px per event still
counted as a click. All five now measure the distance from the press and
allow 3 px, as Leaflet does (056 in device pixels, so 3 · devicePixelRatio).
02 already did this (8 px times the device pixel ratio).

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

### Checked, not a mistake: the city on top wins (07)

Hovering the middle of Tokyo's large circle reports Yokohama or Kawasaki. The
pick returns the last city in draw order whose disc contains the cursor,
and smaller cities are drawn over larger ones, so it reports the disc you
see on top; REQUEST.md says so. A review should read REQUEST.md before
calling a pick wrong.

## Popup

**No mistake found** in maplibre 073, mapbox 127 (the same template) and
leaflet 005: each draw projects the anchor again, so the tip stays on its
coordinate through pans and zooms. Two differences from MapLibre remain:
the popup is drawn on one world copy only, so it vanishes when that copy
leaves the screen, and it never flips its anchor at the screen edge.

## Markers

### A legend that drifts from the data (repeated: openglobus 004 and 062, mapbox 045)

- openglobus 004: five billboards on the map, three in the legend.
- openglobus 062: "Administrative Country Boundaries" over Natural Earth 110m
  land, which has no borders.
- mapbox 045: both colour bars (M1–M3 and M3–M6) used the whole amber–blue–red
  gradient, while the shader goes amber to blue, then blue to red; the M6
  size swatch was 26 px for a 14 px radius.
- Why: legends are written by hand in `index.html` and never compared with
  the bake or the shader's stops.
- Fix: build the legend from the data and the same stops the renderer uses,
  or check its items against them; read REQUEST.md and the legend side by
  side with the screen.

Marker anchoring itself (the tip on the coordinate) was right in every
example checked (010, 009, 213, 244 not yet).

### One class hidden under the other (deckgl 016)

- Screen: Manhattan almost entirely orange; the blue class, 46% of the 13,987
  points, showed only along the edges (6% of the coloured pixels).
- Why, twice over: the points were batched into one path per colour and all
  of weight 1 was filled before all of weight 2, so every overlap went to
  orange; and the radius grew with the weight, so orange squares were also
  larger. deck.gl's example gives every point a radius of 30 m
  (`getRadius: 1`, `radiusScale: 30`) and draws in data order: the weight is a
  class shown by colour only. Read the original's props before copying its
  intent into REQUEST.md.
- Fix: keep one path per colour but per chunk of 256 points in data order,
  and size every point 30 m. Blue rose to 38% of the coloured pixels; redraw
  p95 stayed at 1.5 ms.
- Test: count the pixels of each class colour and compare with the class
  shares in the data.


## Clustering

Only maplibre 056 clusters. Its counts add up (`all-earthquakes-accounted`)
and a click expands a cluster, both checked by its bench. What went wrong
was elsewhere: the clusters, their labels and hit testing sat on one world
copy (see World wrapping), and a 1 px move turned a click into a drag (see
Interaction). Its circles overlap heavily at zoom 3; MapLibre's own example
overlaps as well, so it was not judged a mistake.

## KDE / heatmap

### A world-sized density canvas (maplibre 053)

- Screen: from zoom 7 the heat vanished; at zoom 2.5 the field was cut by a
  straight line at 180° (Aleutians, Tonga).
- Why: the kernels were accumulated into one canvas the size of the world at
  the current zoom, 256 · 2^zoom px wide: 16,384 px square (about 1 GB) at
  zoom 6, past the browser's canvas limit at zoom 7. Kernels at the world's
  edge were clipped by the canvas, and the copies placed side by side showed
  the cut.
- Fix: accumulate for the screen plus half a screen on each side, for every
  world copy that reaches it; rebuild on zoom and when a pan leaves the
  margin. Pans stayed at about 1 ms.
- Test: zoom to the maximum the controls allow, and look at 180°.

### Colours added instead of density mapped (maplibre 053, not fixed)

The kernels are coloured sprites added with `lighter`, so dense areas add up
to white over much of the Pacific rim; MapLibre accumulates a scalar density
and maps it through the ramp, so only the densest cores reach the top
colour. Accumulate density in one channel (or alpha) and colour it in a
second pass. 011 was not reviewed for this.

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

### A field read under the wrong name (webgpu 001)

- Screen: the tallest towers around Tokyo Station stood in the wrong
  places, and every building had a square footprint sized from its height.
- Why: the bake took the third value of 16's `truth.points` as the roof
  height in cm. It is the footprint area in m2. The widest buildings became
  the tallest (16,237 m2 drawn as 162 m), and the real tallest (241.5 m)
  was drawn 104 m.
- Test: put a known extreme from the source next to the rendered one: the
  tallest instance must be the building truth.json names as tallest
  (`heights-from-plateau`).
- Fix: measure heights in 16's archive (cast down through the L0 meshes at
  each footprint point, top hit minus bottom hit) and size each box from
  the real area.
- Lesson: before using another example's baked file, read the code that
  writes each field. A comment on the reading side (`maxz_cm`) is not
  evidence.

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
- 180 was copied from the same code.

### Rings clipped by dropping hidden vertices (repeated: cesium 244, openglobus 062)

- Screen: a dark band with straight edges cut across western Eurasia and
  Africa whenever a continent crossed the rim.
- Why: each land ring was drawn vertex by vertex, skipping vertices behind
  the horizon and starting a new subpath after each gap. Every visible run is
  closed by a chord when filled, and the chords cut the land. Holes were also
  filled as separate rings.
- Fix: as above. Bake earcut triangles instead of rings (land.bin, 27.7 KB
  gzip against 39.0 KB for the rings as JSON) and draw them split, pinned to
  the rim and in one path. Do not ship earcut to triangulate at run time: it
  alone is larger than a 3.5 KB code budget.
- Lesson: three globe examples, three ways to get the horizon wrong. Any
  Canvas 2D globe must clip land at the horizon by geometry, not by skipping
  points; copy the cesium 213 code.
- openglobus 062, added after 244 was fixed, filled its rings the same way
  (wedges over the Arctic and west of South America). It now fills the baked
  triangles like 244 and keeps the rings only for its outlines: skipping
  hidden vertices is fine for a stroke, wrong for a fill. To fit both files
  in 55 KB the rings went to 2 decimals (about 1 km, finer than 110m).
  Its legend also said "Administrative Country Boundaries" over coastline
  data; it now says what is drawn.

### A template highlight that contradicts the sun (cesium 209)

209 lights the globe from a sun the slider moves, but kept the template's
ocean gradient brightest at a fixed upper left: with the sun at 40° E the
ocean was brightest far to the west, on the side the terminator darkens.
Put the highlight under the sub-solar point (centre when the sun is behind
the globe). When a renderer adds a real light, remove every baked-in light
the template had.

## Cartographic layout

### A fixed opening zoom that does not fit (forge3d 004)

At zoom 10 Luxembourg is 827 px tall, so its northern and southern lines were
cut in an 800 px window. Fit the opening view to the data's bounds at load.

### Map furniture written by hand (forge3d 010)

- Screen: a finished-looking plate whose collar said 122°00'W to 121°30'W
  and 46°45' to 46°55'N, a 10 km scale bar at every zoom, a legend of 500 to
  4,392 m and a "1:50,000" title; the latitudes were also cut off by the page
  edge.
- Why: every element was a fixed string or number, and the bake wrote a
  hand-typed bounding box ([-122.0, 46.7, -121.6, 46.95]) next to a DEM
  read from Terrarium tile z10/165/360, whose real extent is about
  121.99° to 121.64° W, 46.80° to 47.04° N. Converted through the wrong box,
  the summit pixel lay about 11 km south of Mount Rainier.
- Fix: compute the tile's bounds from z/x/y in the bake and the summit from
  the highest sample (121.761° W, 46.853° N), then derive the collar labels
  from where the relief is drawn, the scale bar from km per pixel (a round
  distance of 55 to 92 px), the legend from the data's minimum and maximum,
  and the relief's aspect from the ground size. Rotate side labels so they
  fit the margin.
- Test: convert a known feature's pixel back to coordinates; zoom and check
  that the scale bar's distance changes.

### A graticule step fixed by zoom band (maplibre 056)

At zoom 0 the 10° lines were 14 px apart and the longitude labels ran into
each other, with values such as −370°. Choose the step from the pixel
spacing (the smallest of 0.5, 1, 2, 5, 10, 30, 60° that is at least 60 px
apart) and print longitudes normalised to −180..180.

### Base data too coarse for the scale (repeated: tangram 004 and 001)

- Screen: no San Francisco Bay; coastal highways over the sea, at zoom 8 on
  Natural Earth 110m land.
- Rough limits for Natural Earth: 110m to about zoom 3, 50m to about 5, 10m to
  about 8 to 9; beyond that, OpenStreetMap-derived land.
- Fix within a 45 KB data budget: keep world 110m for zooming out, cut 10m
  countries to the opening view plus a margin, fill that box with the sea
  colour, clip to it and draw the 10m land. 110m needs only 4 decimals in
  Mercator units, which saved 6.3 KB, more than the 5.0 KB the detail cost.
- Test: overlay the line data and look for lines over water.

tangram 001 was built on the same Bay Area data after 004 and repeated the
mistake; it now carries the same 10m detail box (its land loop also lacked
world copies, under the name `this.land`). The template examples draw 110m
land at their opening zooms too; 009 (Copenhagen at zoom 8) and maplibre 084
(New Jersey at zoom 8) show the same mismatch on their coasts, not fixed.

## Outside the twelve

### Reading both sides of a pair (deckgl 001)

- Screen: all 200 migration arcs of Los Angeles in the in-flow colour,
  although its own record has 449 in-flows and 892 out-flows.
- Why: the selection took every record with the county as source or
  target. The other counties' records about Los Angeles carry the sign from
  their side, so an out-flow from Los Angeles arrived as a positive value and
  was drawn as an in-flow, and each pair was counted twice, which also pushed
  smaller flows (Hawaii, Puerto Rico) out of the top 200.
- Fix: use only the selected county's own record, as deck.gl reads
  `selected.properties.flows`.

### A sign read the wrong way round (deckgl 014)

- Screen: 1,500 county pairs coloured eastward and westward, every one the
  wrong way round: Los Angeles's net loss of 18,204 people to San
  Bernardino, east of it, was drawn westward.
- Why: 014 had learnt from 001 and kept one record per pair, but assumed
  `flows[s][t] > 0` meant a move from s to t. It means a net in-flow to s
  (deck.gl colours it as in-flow; `LA.flows[Riverside]` is −12,111). All its
  checks counted colours and lines, so they passed either way.
- Fix: eastward is `−flows[a][b]` with a the western end. Check the sign
  against one fact that is known independently (a large, well-known flow),
  and make that a bench check: 014 now has `la-to-san-bernardino-eastward`.
- Also: the page never said which colour was which; the title now does.

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
