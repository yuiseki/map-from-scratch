---
name: visual-review
description: The rendering mistakes that passed every bench check and unit test in this repository and were found only by opening the page and looking at it (axis factors applied twice, 3D sign errors, an upside-down camera, globe triangles folding over the horizon, missing world copies, coastlines too coarse for the zoom, sea level read as land, Range retries that defeat a CDN, legends that drift from the data), with the review procedure that found them. Load it before calling a map-from-scratch renderer done, when reviewing examples someone else (or another agent) wrote, and when writing verification checks, so the checks test the geography instead of the code's own output.
---

# Visual review: what only the screen shows

Two review passes over the examples (2026-10-30) fixed 19 of them; in 13 the
opening view or the first interaction was visibly wrong, the rest had the
same fault waiting in another view. `bin/mfs test` caught none of them, and
the bench checks could not: they read pixels at places derived from the
renderer's own output. Example 25's check coordinates had been written
against a projection that squashed Akita to 0.64 of its width. This
skill is the procedure that found the bugs and the catalogue of what it
found. Each entry says how it looked, why, how to test for it, and what fixed
it; the example ids point to the commits.

## 1. Procedure

Do this for every page, in a real browser, at 1920×1021 and at the bench
viewport (1280×800). Use the dev server (`bin/mfs serve`) so data under
`data/baked` is served.

1. **Look at the opening view before touching it.** Name three features and
   say where they must be relative to each other (Paris north-west of Cairo,
   Tokyo east of Osaka, the Bay inside the coast). Check sizes against known
   ratios: Akita is about 1.6 times taller than wide; Luxembourg must fit an
   800 px window at the opening zoom.
2. **Read the console and the network list.** A Range read that answered 200,
   a 404 on data, a wasm MIME error: each is a bug even when the picture looks
   fine.
3. **Operate every control.** Drag in both axes and check that the content
   follows the pointer, wheel in and out, press every button and select,
   hover something with a tooltip. After any change to a camera, re-check the
   drag directions.
4. **Push the view to the edges of the data.** Zoom out to the whole world
   (the antimeridian, the poles, the edge of a detail box), rotate a globe so
   a continent sits on the rim, tilt a 3D view to the steepest and the
   flattest pitch.
5. **Compare the legend, the labels and the data.** Count the items drawn and
   the items listed.
6. **Before fixing, rule out the view.** Change the camera and look again: a
   brown "rectangle" around Fuji in example 17 was a contour band seen in
   perspective, and a staircase in d3-016 is a limitation REQUEST.md already
   states. Read REQUEST.md before calling something a bug.
7. **After fixing, run the page with `?bench` in the browser** (define
   `window.__mfsEmit` in an init script to collect the reports) as well as
   `bin/mfs test`, and measure size and frame time against the budgets.

## 2. Projection and camera

### An axis factor applied twice (25)

Akita was drawn at 0.64 of its east-west width. The vertex shader multiplied
x by the geographic aspect (`GEO_ASPECT = 0.64`) and then, in the wide-screen
branch, divided by `screenAspect / GEO_ASPECT`, applying it a second time.
The hover inverse repeated the same mistake, so picking still worked.

- Test: compute the drawn width and height of the data's bounding box in
  pixels and compare their ratio with the ground ratio (km east-west over km
  north-south). Do this in a check, not by eye.
- Fix: scale by the geographic aspect once, then undo only the screen aspect.
  Move the inverse with it, and recompute any bench coordinates that were
  tuned to the old output.

### Extrusions going into the ground (deckgl-007)

Tall blocks hung below Vancouver's southern shore: the city was drawn as if
seen from under the ground. The orthographic camera had
`screen.y = r.y·sinφ − z·cosφ` and `depth = −r.y·cosφ − z·sinφ`.

- Rule, for φ the elevation angle of the view (90° = straight down) and r.y
  the distance towards the far side: `screen.y = r.y·sinφ + z·cosφ` and
  `depth = r.y·cosφ − z·sinφ` (far is deeper, high is nearer).
- Test: nothing extruded may appear outside the footprint's outline on the
  near side; the tallest feature must rise towards the top of the screen.

### An upside-down camera (deckgl-019)

Mount St. Helens looked like a funnel with the void at the bottom of the
screen. The eye stood on the bearing side of the target while `right` stayed
pointed for the opposite view, so `up = right × forward` pointed down and the
image was turned 180°.

- Rule: derive `forward` from the eye, `right` from the bearing, `up` from
  `right × forward`, and assert `up.z > 0`. deck.gl's bearing 0 looks north,
  so the eye stands south of the target.
- The vertical pan was also reversed. Test both drag axes after any camera
  fix.

### A fixed opening zoom (forge3d-004)

At zoom 10 Luxembourg is 827 px tall, so its northern and southern lines were
cut off in an 800 px window. Fit the opening view to the data's bounds at
load with a margin. Check the units of the baked data first: that bake had
already projected to Web Mercator 0..1, and fitting it as lon/lat put the
camera at zoom 15 in the Gulf of Guinea.

## 3. The world: antimeridian, globe and coastlines

### No world copies (maplibre 010, 012, 013, 061, 070, 073; mapbox-127)

Alaska ended in a straight vertical edge at 180°, and the far side of the
Pacific was empty, in every Canvas 2D example that drew the land once. Any
view wider than the world at that zoom, or panned across 180°, needs the land
repeated: loop `wrap` from `floor(centerX − width / (2·scale))` to
`floor(centerX + width / (2·scale))` and shift x by `wrap·scale`, as example
069 does. The stroke along the 180° cut stays visible as a thin seam; leave
it out of the stroke if it matters.

### Globe triangles folding over the horizon (cesium-180, cesium-213)

Northern Eurasia spread over the Arctic Ocean as a green wedge with straight
edges. The land was Natural Earth 110m triangulated by earcut in lon/lat, so
single triangles spanned tens of degrees. Each was projected from its three
corners and filled flat; a corner behind the horizon projects inside the
disc, and the triangle folded back over the visible side. Culling only the
triangles with all three corners behind does not help.

- Fix: split the triangles once at load until no edge is longer than 20°,
  keep the corners as unit-sphere xyz (a frame then only rotates them), move
  the far corners of a triangle that crosses the horizon onto the rim, and
  fill all triangles as one path (no per-triangle stroke to hide seams).
- Numbers: 4,758 → 10,263 triangles. One path redrew faster than 4,758
  separate fills (32.6 against 37.9 ms p50 including a GPU read-back in
  Chrome on a Mac); 6° (30,072 triangles) was four times slower. Splitting at
  bake time instead costs data: 12° already made the land 67 KB gzip.
- Test: rotate so a large landmass sits on the rim (pitch ±1.1, any yaw) and
  look for straight edges over the sea.

### A coastline too coarse for the zoom (tangram-004)

The Bay Area highway demo had no San Francisco Bay and drew coastal highways
over the sea: the land was Natural Earth 110m at zoom 8. Rough limits for
Natural Earth: 110m to about zoom 3, 50m to about 5, 10m to about 8 to 9;
beyond that use OpenStreetMap-derived land.

- Fix without blowing the data budget: keep the world 110m for zooming out,
  cut 10m (`ne-countries` in `tools/sources.ts`) to the opening view's box
  plus a margin, and in the renderer fill the box with the sea colour, clip
  to it, and draw the 10m land. The margin keeps the cut edges outside the
  clip. 110m coordinates need only 4 decimals in Mercator units (about
  4 km); that saved 6.3 KB gzip, more than the 5.0 KB the detail cost.
- Test: overlay the line data (roads, rivers, boundaries) and look for lines
  over water.

## 4. Values and data

### Sea level read as land (21)

The whole ocean was the lowland green. Mapterhorn has no bathymetry: the sea
is exactly 0 m, and the shader coloured only `h < 0` as water. On top of
that, `texelFetch(...).rgb * 255.0` is not an integer (128 comes back as
128.00002), so 0 m decoded as about +0.005 m.

- Fix: round the bytes, `floor(rgb * 255.0 + 0.5)`, before Terrarium
  decoding, and treat `h <= 0` as sea.
- Test: decode a known ocean tile on the CPU and count values below, at and
  above zero before choosing the threshold (3/7/3 had 258,667 of 262,144
  pixels at exactly 0).

### A legend that drifts from the data (openglobus-004)

The map drew five billboards from the baked JSON; the legend in
`index.html` named three. Build the legend from the same data the renderer
draws, or check that the counts match.

## 5. Fetching

### Range retries that defeat the CDN (10, 18, 24)

Example 10 always failed with "Range 要求が繰り返し HTTP 200". The Cloudflare
front of z.yuiseki.net answers the first request for a URL with 200 and the
whole file, and later requests with 206. The retry added `?retry=N`, so every
attempt was a first request.

- Measured with curl: a fresh query string gives 200, then 206 on the next
  request to the same URL; the base URL, once warm, gives 206 every time.
- Fix: cancel the 200 body and retry the same URL. Example 24's counter
  ("HTTP 200 再試行 1 回") showed the fix working on a cold URL.
- Mapterhorn's download host answered 206 from the first request; check
  each host instead of assuming.

### The dev server's MIME types (22)

`WebAssembly.compileStreaming` refuses anything but `application/wasm`; the
dev server sent `.wasm` as octet-stream, and every load logged an error and
fell back. GitHub Pages was fine, so only local runs showed it. Fixed in
`harness/lib/serve.ts`.

## 6. Checks that test the geography

The fixes above were invisible to the checks because each check asked the
renderer where something was and then looked there. Write checks against
facts the renderer does not compute:

- ratios and orderings from the ground (width over height of a known region,
  east-west order of two cities, a peak above its base);
- the count of drawn items against the count in the data;
- the absence of land colour at a known sea point near the rim, the
  antimeridian, or the edge of a detail box;
- the content moving with a synthetic drag in both axes.

When a fix moves things on the screen, a check that fails afterwards may have
been testing the bug. Recompute its coordinates from geography, say so in
the commit, and do not loosen its tolerance.

## 7. Budgets after a correctness fix

- `code_gzip_bytes` is the sum of per-file gzip of the shipped files, and
  comments ship. Repetitive code compresses well, so replacing three
  copy-pasted vertex blocks with a loop and a helper still grew cesium-213 by
  about 300 B. Shorten comments, share helpers, then measure again.
- If a budget still cannot hold the fix, change the budget in `spec.yaml`
  with the reason next to it, and record the finding in
  `performance_knowledge`. A wrong map within budget is not a pass.
- Compare old and new frame times in the same browser and the same way: on
  a Mac, `getImageData` adds the GPU sync, so absolute numbers are far above
  the Linux bench machine's; the ratio is what carries over.
