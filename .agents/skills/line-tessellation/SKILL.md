---
name: line-tessellation
description: How map engines turn polylines into triangles or pixels of the right width (where the width lives, vertex layout, joins and caps, edge antialiasing, distance along the line for dashes, clipping and tile seams, vertex reduction before stroking), with what they measured and what they reverted. Load it when a map-from-scratch request draws roads, borders, routes, tracks, contours or any stroke wider than a hairline, before writing the line part of `bake.ts` or the line shader, or when lines change width with zoom, spike at corners, vanish, show seams at tile or clip edges, render dashes as solid, or cost too much vertex time.
---

# Line tessellation: from a polyline to a stroke of the right width

A polyline has no width. To draw it, a renderer must choose where the width
is applied (in the data, on the CPU at each zoom, or in the vertex shader),
how corners and ends are filled, how edges are antialiased, where distance
along the line comes from (dashes, gradients), and what happens where the
line is cut by a tile or the viewport. General engines answer all of these at
run time for any style; most of their line code handles widths, joins, dashes
and offsets that a given map never uses. A renderer made for one request
knows the widths, the zoom range and the style, so most of the work and many
of the failure modes can be settled at bake time. This repo already draws
lines two ways: 1 px borders with `gl.LINES` (02) and a road network as
instanced 4-vertex strips widened in the vertex shader, with square caps
hiding the joints, one draw call, 1.2 M segments in 1.1 ms p95 (05) [117].
Read this before going beyond that.

Per-engine detail and smaller decisions: [references/engines.md](references/engines.md).
Numbers in brackets refer to the Sources list at the end of this file.
Related skills: `float-precision`, `polygon-triangulation`,
`tile-lod-and-overzoom`, `vector-tile-encoding` in `.agents/skills/`.

## First question: where does the width live?

| The request | Width applied | Engines that show the cost of the other way |
| --- | --- | --- |
| Fixed scale (one zoom, a static image, a microcontroller) | In the data or the rasteriser: stroke the projected line once | none needed; CPU strokers do this (Mapnik, MapServer) [81][91] |
| Continuous zoom, width in screen pixels | Bake centreline + direction, extrude in the vertex shader by `width_px * pixel_size` | maplibre-rs [9][10], RustGIS [14], walkers [112][114] |
| Continuous zoom, CPU tessellation unavoidable (user tracks, per-segment colours) | Rebuild per zoom on a fixed zoom grid with hysteresis | OsmAnd [97][102] |
| Lines that must follow a terrain surface unknown at bake time | Per-segment volumes or per-tile lookup textures in the globe shader | Cesium [17][18][19] |

Evidence for pushing width into the shader:

- maplibre-rs tessellated lines in world space, so their width changed with
  zoom; the fix scales the width by the zoom fraction in the vertex shader
  [9]. A later pipeline offsets in clip space by `line_width/2` plus a 0.5 px
  antialiasing outset, multiplying by `w` to undo the perspective divide and
  converting per axis for non-square viewports [10].
- RustGIS replaced tiny-skia pictures keyed by zoom rounded to 1/256 (every
  zoom change missed the cache) with meshes made once per tile and level,
  strokes tessellated at width 1 and extruded along normals in the vertex
  shader: Manhattan z14.3 meshes 106 ms / 27.7 MB against 440 ms of pictures
  per zoom step; native zoom frames 35 → 7 ms (z12) and 64 → 24 ms (z14); in
  the browser about even, because tessellation and uploads stayed on one
  thread [14].
- walkers moved tile lines from egui shapes rebuilt each frame into its own
  GPU buffers with pan and zoom as a uniform and sideways extrusion in the
  vertex shader: a frame went from about 42 to about 24 ms [112]. Holding
  `line-width` in screen pixels fixed lines that were 4x too thin and doubled
  between levels [114].
- OsmAnd, which builds line geometry on the CPU, shows the cost of the other
  way: a 50,000-point line took about 1,168 ms to rebuild (Debug simulator),
  and rebuilding when the visual zoom moved by more than 0.25 left one zoom
  level at two thicknesses (1.41x too thick approaching z15 from below, 16 %
  too thin from above), because its visual-zoom encoding is asymmetric. It
  now snaps to a 0.5 zoom grid with a 0.01 hysteresis band: 3 rebuilds per
  level instead of 2, up to 19 % width error at a zoom between steps, and 0
  instead of 119 rebuilds for a camera jittering on a boundary [97].
- Never rely on `gl.lineWidth` above 1: TerriaJS drew thick polygon outlines
  as polylines because WebGL on Windows ignores it [77]; osgEarth expands
  lines in the shader because GL core profile does not support it [79];
  MapLibre Native triangulates fill outlines on Metal and WebGPU, keeping
  `gfx::Lines` only on GL [8]. A 1 px hairline with `gl.LINES` is fine (02)
  [117].
- Storage buffer vertex pulling in modern WebGPU: pygfx skips vertex buffers
  and CPU polygon tessellation entirely. It puts node positions into a
  storage buffer and emits `6 * N` vertices with no vertex attributes bound.
  The vertex shader uses `vertex_index` to pull $P_{i-1}, P_i, P_{i+1}$,
  generating screen-space miters, bevels, round caps and round joins in WGSL
  [118]. In `webgpu-002-vertex-pulled-roads`, 11,509 Tokyo road ways (88,354 raw
  nodes, 76,845 segments) are held in an 8-byte packed storage buffer
  (`uploadCount = 1`, zero CPU vertex allocation). Single draw call
  `draw((nodeCount - 1) * 6)` with zero-area culling for road boundaries
  delivers 0.075 ms p50 / 0.170 ms p95 redraws during interactive pan and zoom,
  completely eliminating CPU attribute expansion and buffer reallocations.

## Decisions, with trade-offs and evidence

### Primitive and vertex layout

- A quad per segment, indexed: ortho-earth went from 6 non-indexed vertices
  per segment (each decoding and projecting both endpoints) to 4 indexed
  ones: 20.49 → 16.46 ms at z3 for 2.1 M synthetic edges, 0.70 → 0.33 ms for
  2D Tokyo z13, 7.77 → 6.34 ms for a pitched Fuji view; no change where not
  vertex-bound (z14, z8) [31]. Instancing one 4-vertex strip over the segment
  array (05) gets the same sharing with no index buffer [117].
- Element arrays for CPU-built strokes: tangram's rewrite gave ~30 % faster
  builds, 30–40 % less GPU memory, 30–67 % fewer join and cap triangles [57].
- 16-bit indices overflow silently: iTowns rendered garbage once merged bus
  lines passed 65,535 vertices and switched to Uint32 [74]; TerriaJS's old
  protomaps renderer had a 5,400-vertex-per-tile limit [75]. Split batches
  under 65,536 at bake time or choose Uint32, and fail the bake on overflow.
- Vertex stride: MapLibre Native moved line normals out of the low bit of the
  int16 position because Broadcom GPUs mishandled it (8 → 10 bytes) [5]; a
  month later GL JS padded its 10-byte vertex (3 Int16 + 4 Uint8) to 12
  bytes (4 Int16 + 4 Uint8) because "10 byte vertices are heavily penalized
  by common GL implementations" [1]. GL JS's layout is
  10 bytes again since September 2026, when `a_offset_normal` (Int8x2) was
  added for line offsets [4]. Measure the stride on the target GPU; do not
  bit-pack flags into positions without testing there.
- Keep rare high-precision data in an optional buffer: GL JS adds a second
  vertex buffer for line progress only when a layer uses gradients [2].
- WebGL2 and WebGPU have no geometry shaders; QGIS removed its geometry
  shaders and draws lines as instanced segments plus a second instanced pass
  for joins [39]. Cesium replaced per-segment instances with batch-table
  lookups by "fat vertices" carrying the segment data [20]. deck.gl's
  PathLayer already used 13 of the 16 attributes WebGL guarantees, and each
  dash option adds one [27]: count attributes before adding features.

### Joins and caps

- Choose the join for the width. Square caps that overhang by half the width
  hide the joints of thin lines with no join geometry at all (05) [117].
  MapLibre's CPU tessellator uses 20° per triangle for round joins (it was 30°)
  [6], adds extra vertices 15 px from corners sharper than 75° so dashes
  tilt less, switches miter to a "flipbevel" when the miter
  length exceeds 2, and draws bevel as miter limit 1.05 [4]. Its sharp-corner
  offset is divided by the overscale factor and disabled above 16x, where it
  broke [7].
- tangram sizes round-join fans by zoom and emits no caps where the line was
  cut by the tile edge [57]. OsmAnd adopted the Polyline2D library (miter,
  bevel, round; miter falls back to bevel at large angles) with plain
  triangles instead of a strip once segments needed independent colours
  [100].
- Degenerate input is the main source of artefacts. deck.gl zeroes segments
  shorter than 0.1 px instead of normalising them (miter spikes) [26];
  tangram drew short lines as triangles from repeated last points (4,443
  repeated indices in one tile) and from points quantised together [58][59];
  OpenLayers divided by zero at join angles of 0 or 2π and computes segment
  distance as a capsule [50]; osgEarth had to clamp the cosine before `acos`
  and handle clipping before the divide by `w` [80]. galileo found that
  sub-pixel segments make "pointy" miter spikes at low zoom and tessellates
  once per LOD [111].
- Translucent lines darken where segments or joins overlap. vtm clears depth
  and draws each translucent line style with depth test and writes, so each
  pixel is written once, at the cost of one depth clear per style [105];
  osmdroid accepted the darker vertices of `Canvas.drawLines` [107].

### Edge antialiasing in the quad

- Centre the ramp on the edge: OpenLayers' ramp from 0 to −1 px made every
  line 1 px thinner than asked; ±0.5 px fixes it, and the quad must be
  widened by 0.5 px [49]. Pass the device pixel ratio when the shader uses
  `gl_FragCoord` (lines too thin or missing on iOS) [51].
- deck.gl made shader antialiasing opt-in, compiled as a separate variant so
  the default pays nothing, expanding vertices by half a pixel; multiplying
  coverage after premultiplication raised the worst overshoot from 2 to 126,
  and over MSAA the golden image changed (98.28 % match) [22][23]. Cesium
  keeps a half-pixel fade on by default with an off switch for speed [15][16].
  Full detail belongs to antialiasing; for lines, budget the half-pixel
  outset in the clip padding below.

### Distance along the line: dashes, gradients, patterns

- Per-segment phase breaks on dense lines: deck.gl's default restarts the
  dash at every rendered segment, so GPS traces, coastlines and
  globe-subdivided paths render solid once segments are shorter than the
  dash [21]. Its continuous mode accumulates distance on the CPU over the
  final rendered geometry (after subdivision and antimeridian cuts; the older
  `highPrecisionDash` measured source geometry and was wrong there) into a
  per-vertex attribute, and reduces it modulo the period in the vertex shader
  [21][27].
- Float precision of the accumulated distance: OpenLayers splits it into low
  and high float attributes and reduces each modulo the pattern length,
  removing artefacts above zoom 20 [48]. navara stores a high part
  (multiples of 16,384 m) plus a low part and computes the phase in u32 [13].
  MapLibre stores `linesofar` in 15 bits at half a tile unit per step and,
  when the distance passes half the maximum, resets it to zero and emits the
  vertex again (a phase jump it accepts inside a tile) [4].
- Across features: an open, unmerged Organic Maps PR proposes extending the
  serialized metalines section to carry continuous dash phases across
  adjacent features [103]. GeoServer fuses touching segments into long
  LineStrings at encode time [96].
- Cheap and robust dash shading: deck.gl integrates the dash square wave over
  the pixel footprint (0.2 px period: mean/stdev 107.7/125.9 → 127.5/0.5
  against 127.5), for about 0.10 ms more in an overdraw-heavy 4K pass and no
  cost in sparse ones [24]. Sanitise dash arrays: `0,0` hung Chromium in
  kothic [68]. On Canvas 2D, clip before `setLineDash` because dash cost
  follows the full path length (maptalks) [66], and prefer native dashes
  over a JS dash walker (kothic, "massive" speed-up) [67].

### Clipping and tile seams

- Pad every clip by what the stroke can reach: half the widest stroke, plus
  any offset, plus the antialiasing outset, converted into the clip space's
  units. Without it, outlines appear along the clip edge (Leaflet [56],
  MapServer [90][93], Mapnik [86]). GeoServer's buffer was 16x too small in
  oversampled tile coordinates [94]. Mapnik's formula is
  `ceil(max(width/2 + |offset|, |offset| * 5.0))` pixels times scale factor
  [86].
- Clip edges are not real edges: mark them or draw outlines from separate
  linestrings. harp clips with a ~5 % buffer and stores per-vertex clip state
  [63]; Marble keeps clip points and tags their index runs [44]; kothic skips
  segments between two points on the same tile boundary (bitmask) [70].
- Line ends at tile seams: kothic prolongs line ends past the tile edge; in
  screen pixels the extension was 10 % of a 512 px tile and showed as lines
  along the border, in tile units 0.5 % [69]. tangram-es instead drops
  segments outside the tile so buffered tiles do not double-draw [62]; harp
  made line clipping opt-in and accepted slightly wider roads from fallback
  tiles over cap outlines [64].
- Cheap clipping where it runs at run time: test the feature's bounds first
  and skip clipping when it is inside (MapServer [92][89], cartopy [115]);
  QGIS's fast clip on long contour lines was a "huge improvement" for WMS
  [37]. Clip in screen
  space bounded by the rotated view's circle, not a fixed limit (osmdroid:
  int overflow at zoom 29, missing hardware-accelerated paths) [108]; compute
  intersections in wider precision (navit) [110].

### Fewer vertices before stroking

- Drop vertices closer than one pixel at the target zoom: MapServer does it
  while projecting (closed rings keep at least 4 points) [91]; OpenLayers
  calls `lineTo` only when the pixel changes, because thick Canvas lines slow
  down with repeated same-pixel calls [47]; vtm drops points closer than 1/8
  tile unit and later exposed the distance per style because a fixed value
  made overlays vanish [106]; maptalks draws geometries under 1x1 px as one
  `fillRect` [65].
- Simplify the centreline with a tolerance that is a fraction of the stroke
  width, then compute joins on the kept points. OsmAnd tightened it from
  half to a third of the half-width and moved it from the offset edge to the
  centreline [99]; it skips simplification for per-point coloured lines,
  which would lose data, not shape [101].
- Tessellate at the data's own density: a TerriaJS track of 365 daily
  samples became 525,600 vertices under Cesium's default 60 s subsampling,
  and memory grew to about 1 GB [76].
- Project once, draw many passes: Marble reused one projected line for
  casing, fill and label, about 20 % faster on a busy level-11 view [43].

## Tried and reverted

- Bit-packed normal flags in int16 positions (Native, Broadcom) [5]; 10-byte
  vertices padded to 12 (GL JS, 2017), though the current layout is 10 bytes
  again [1][4].
- Round joins at 30° per triangle → 20° [6].
- Geometry clipping on by default for every Mapnik symbolizer (2012), then
  off by default (2014) after months of stroke, offset, marker and
  reprojection artefacts [85]; a true offset line for `text-dy` reverted
  after a 300x slowdown [84].
- MapServer's pass to clean degenerate clipped edges caused "polygon
  flooding" and was dropped for a 2 px clip pad [90].
- OsmAnd: Douglas-Peucker on the offset edge (replaced the same day) [99];
  the 0.25 visual-zoom threshold, and plain rounding to the grid without
  hysteresis [97].
- deck.gl: `highPrecisionDash` measured on source geometry [21]; a uniform
  branch for antialiasing (replaced by compiled variants); alpha-to-coverage
  parked [22].
- osgEarth: a quantised-stipple change partly reverted for distortion at
  some orientations [80].
- kothic: line extension by 5x the last segment, then 50 screen px, then a
  fraction in tile units [69].
- Cesium ground polylines: computing planes in the vertex shader was dropped
  for exceeding the attribute budget; centimetre jitter first blamed on the
  endpoint encoding was fragment precision from plane points 100 km below
  the ellipsoid [17].
- maplibre-rs: lyon's stroke tessellator in tile units → pixel-unit
  extrusion in the shader [10]. RustGIS: per-zoom pictures → meshes [14].

## Guidance for a renderer here

1. Write down the stroke widths and zoom range in `spec.yaml` first. If all
   lines are 1 px, use `gl.LINES` or Canvas 2D and stop (02) [117].
2. For wider lines under continuous zoom, bake the centreline (projected,
   quantised relative to a tile or chunk origin, never per long feature:
   tangram-es lines vanished and changed width [61]) and extrude in the
   vertex shader, as 05 does [117]. Rebuild-on-zoom logic is then
   unnecessary [97][102].
3. Clean the line at bake time per zoom band: dedupe points equal after
   quantisation, drop points closer than ~1 px, remove collinear points,
   merge touching segments into long lines [58][91][111][96]. Keep a shader
   epsilon guard anyway [26][50].
4. Joins: none plus square caps for thin lines; miter with a bevel fallback,
   or round joins computed per fragment from the capsule distance, for thick
   ones; CPU fans only if the style demands them [4][6][50].
5. Indexed or instanced quads, 4 vertices per segment; stride a multiple of
   4 bytes unless measured otherwise; Uint32 or batches under 65,536
   vertices with a bake-time check [31][1][74].
6. Antialias in the quad (±0.5 px ramp, DPR uniform) unless the target has
   MSAA you own [49][51][22].
7. Dashes only if asked: bake cumulative distance on the final geometry,
   continued across tiles, reduced modulo the period or reset per tile
   before it reaches float32 [21][48][103].
8. Clip at bake time with a buffer computed from the widest stroke + offset
   + 0.5 px at that zoom, in the quantised units, and keep clip edges out of
   outlines [86][94][63].
9. Translucent lines over each other need stencil or depth to avoid double
   blending [105]. Picking lines through an id buffer needs them drawn as
   quads a few pixels wide; GL lines and thin lines go missing [78][72].
10. Bench the expensive end separately: the all-in-view frame is where line
    vertex work dominates (05 was vertex-bound, flat across views) [117].

## Sources

1. https://github.com/maplibre/maplibre-gl-js/commit/991ab7d1a
2. https://github.com/maplibre/maplibre-gl-js/commit/58a73906d
3. https://github.com/maplibre/maplibre-gl-js/commit/8da5b60dd
4. ref-repos/maplibre__maplibre-gl-js/src/data/bucket/line_bucket.ts, ref-repos/maplibre__maplibre-gl-js/src/data/bucket/line_attributes.ts, https://github.com/maplibre/maplibre-gl-js/commit/24d1f1384 (#8570, 2026-09-28)
5. https://github.com/maplibre/maplibre-native/commit/822df3dd5, https://github.com/maplibre/maplibre-native/commit/1188707dc
6. https://github.com/maplibre/maplibre-native/commit/d30dc89cf71a9f85620c0845b09ccd497bdd94e6
7. https://github.com/maplibre/maplibre-native/commit/aa543e43e5a161f9ccdb6e9b5cda0923b8284ae2
8. https://github.com/maplibre/maplibre-native/commit/893c97f20, https://github.com/maplibre/maplibre-native/commit/8264a1c86, ref-repos/maplibre__maplibre-native/src/mln/renderer/buckets/fill_bucket.hpp
9. https://github.com/maplibre/maplibre-rs/issues/230
10. https://github.com/maplibre/maplibre-rs/commit/0de294e
11. https://github.com/maplibre/maplibre-rs/blob/main/maplibre/src/lib.rs, ref-repos/maplibre__maplibre-rs/docs/src/development-documents/figures/data-model.drawio.svg
12. https://github.com/maplibre/maplibre-tile-spec/blob/main/docs/benchmarks.md, ref-repos/maplibre__maplibre-tile-spec/docs/benchmarks.md, https://github.com/maplibre/maplibre-tile-spec/blob/main/rust/mlt-core/CHANGELOG.md, ref-repos/maplibre__maplibre-tile-spec/rust/mlt-core/CHANGELOG.md
13. https://github.com/maplibre/navara/blob/main/guide/POLYLINE_DASH.md
14. https://github.com/opengeos/RustGIS/issues/596, https://github.com/opengeos/RustGIS/pull/606, https://github.com/opengeos/RustGIS/pull/611
15. ref-repos/CesiumGS__cesium/CHANGES.md, https://github.com/CesiumGS/cesium/pull/13675, https://github.com/CesiumGS/cesium/pull/13703
16. https://github.com/CesiumGS/cesium/commit/d14b301dc06b54f6d994f2cfd353aad7c96160b7, https://github.com/CesiumGS/cesium/commit/09a5810776d8bbc41ea029eca8a5f1a2aa6b404d, https://github.com/CesiumGS/cesium/commit/b470ad5241a2860792f92364f9f22b376258323a
17. https://github.com/CesiumGS/cesium/pull/6615
18. https://github.com/CesiumGS/cesium/pull/13577
19. https://github.com/CesiumGS/cesium/commit/0d0c35fad1cc05ed0560f0d1ec6a9197baaef84e, ref-repos/CesiumGS__cesium/packages/engine/Source/Core/VectorPipeline.js
20. https://github.com/CesiumGS/cesium/commit/612152bf7, https://github.com/CesiumGS/cesium/commit/43dbae214
21. https://github.com/visgl/deck.gl/blob/master/dev-docs/RFCs/v9.4/path-dash-rfc.md, ref-repos/visgl__deck.gl/dev-docs/RFCs/v9.4/path-dash-rfc.md
22. https://github.com/visgl/deck.gl/pull/10520
23. https://github.com/visgl/deck.gl/commit/427df1b0, https://github.com/visgl/deck.gl/commit/9846e044
24. https://github.com/visgl/deck.gl/pull/10581
25. https://github.com/visgl/deck.gl/pull/10580
26. https://github.com/visgl/deck.gl/commit/0fe74cae, https://github.com/visgl/deck.gl/commit/adeeedd7
27. https://github.com/visgl/deck.gl/commit/e0cd7275
28. https://github.com/visgl/deck.gl/commit/a9ea02e2
29. https://github.com/visgl/deck.gl/pull/2522
30. https://github.com/kenjiyoshidahome2026-bit/ortho-earth/blob/main/packages/geopbf/pbf%20spec.md, ref-repos/kenjiyoshidahome2026-bit__ortho-earth/packages/geopbf/README.md
31. https://github.com/kenjiyoshidahome2026-bit/ortho-earth/blob/main/packages/ortho-core/perf%20plan.md, ref-repos/kenjiyoshidahome2026-bit__ortho-earth/packages/ortho-core/perf plan.md
32. https://github.com/kenjiyoshidahome2026-bit/ortho-earth/commit/a4ddf642, https://github.com/kenjiyoshidahome2026-bit/ortho-earth/commit/8952db4d, https://github.com/kenjiyoshidahome2026-bit/ortho-earth/commit/f8bb2182
33. ref-repos/qgis__QGIS/ChangeLog (2016-07-28 "Improve polygon perimeter labeling")
34. ref-repos/qgis__QGIS/ChangeLog (2020-09-21 "defer geometry clipping after transform"), https://github.com/qgis/QGIS/issues/38878
35. ref-repos/qgis__QGIS/ChangeLog (2020-07-10 "Avoid texture jump when panning maps")
36. https://github.com/qgis/QGIS/pull/44941, https://github.com/qgis/QGIS/issues/44939
37. https://github.com/qgis/QGIS/commit/d4f69b3724, https://github.com/qgis/QGIS/commit/3f9cc5d3e7, https://github.com/qgis/QGIS/commit/8b37ea2b05
38. https://github.com/qgis/QGIS/commit/c0f0bd552d, https://github.com/qgis/QGIS/commit/ef292e6ada
39. https://github.com/qgis/QGIS/commit/2c9be6f9e9, https://github.com/qgis/QGIS/commit/97e55af3bb, https://github.com/qgis/QGIS/commit/27db053549
40. https://github.com/OSGeo/grass/commit/cd63bac04, https://github.com/OSGeo/grass/commit/cc9f835d0, https://github.com/OSGeo/grass/commit/bbad61f77
41. https://github.com/OSGeo/grass/commit/b2c28c06c, https://github.com/OSGeo/grass/commit/cc9f835d0, https://github.com/OSGeo/grass/commit/bbad61f77, https://github.com/OSGeo/grass/commit/7f86d1f06
42. https://github.com/OSGeo/grass/commit/c53e754a7, https://github.com/OSGeo/grass/commit/f9e51867b
43. https://github.com/KDE/marble/commit/620499fdb
44. https://github.com/KDE/marble/commit/1426a625e, https://github.com/KDE/marble/commit/9d3bc52f0, https://github.com/KDE/marble/commit/867ec8cb2
45. https://github.com/KDE/marble/commit/2c1bd0ee7, https://github.com/KDE/marble/commit/bcf7bfa6c, https://github.com/KDE/marble/commit/48c412ef1
46. https://github.com/KDE/marble/commit/7244fd48c, https://github.com/KDE/marble/commit/aa5585a61
47. https://github.com/openlayers/openlayers/commit/71a6c4f27
48. https://github.com/openlayers/openlayers/commit/3649f42bd
49. https://github.com/openlayers/openlayers/commit/dea2bab81
50. https://github.com/openlayers/openlayers/commit/0c5f3ad44, https://github.com/openlayers/openlayers/commit/4284c7f6c, https://github.com/openlayers/openlayers/commit/15728539e
51. https://github.com/openlayers/openlayers/pull/13461
52. https://github.com/openlayers/ol2/blob/master/lib/OpenLayers/Renderer/SVG.js, https://github.com/openlayers/ol2/blob/master/notes/2.14.md
53. https://github.com/openlayers/ol2/blob/master/lib/OpenLayers/Layer/Vector.js, https://github.com/openlayers/ol2/blob/master/lib/OpenLayers/Control/Graticule.js, https://github.com/openlayers/ol2/blob/master/notes/2.14.md
54. ref-repos/Leaflet__Leaflet/FAQ.md, ref-repos/Leaflet__Leaflet/CHANGELOG.md, ref-repos/Leaflet__Leaflet/docs/reference.html
55. https://github.com/Leaflet/Leaflet/issues/4745, https://github.com/Leaflet/Leaflet/pull/4808
56. https://github.com/Leaflet/Leaflet/commit/ddb9a376, https://github.com/Leaflet/Leaflet/commit/3c5cf0fd, https://github.com/Leaflet/Leaflet/commit/b329c4a9, https://github.com/Leaflet/Leaflet/commit/4952b372
57. https://github.com/tangrams/tangram/pull/313
58. https://github.com/tangrams/tangram/issues/457
59. https://github.com/tangrams/tangram/commit/289928ca, https://github.com/tangrams/tangram/commit/37d40082
60. https://github.com/tangrams/tangram/issues/355
61. https://github.com/tangrams/tangram-es/issues/1463, https://github.com/tangrams/tangram-es/issues/994
62. https://github.com/tangrams/tangram-es/commit/6bb54a16, https://github.com/tangrams/tangram-es/commit/1041dc73, https://github.com/tangrams/tangram-es/commit/8af6cacb
63. https://github.com/heremaps/harp.gl/commit/e44a6133, https://github.com/heremaps/harp.gl/commit/0661e04c
64. https://github.com/heremaps/harp.gl/commit/254ab363
65. https://github.com/maptalks/maptalks.js/commit/ad4c0f538, https://github.com/maptalks/maptalks.js/issues/1266
66. https://github.com/maptalks/maptalks.js/commit/a24ef1f82
67. https://github.com/kothic/kothic-js/commit/8d66944, https://github.com/kothic/kothic-js/issues/58, https://github.com/kothic/kothic-js/issues/60
68. https://github.com/kothic/kothic-js/issues/48, https://github.com/kothic/kothic-js/commit/2ad6db2
69. https://github.com/kothic/kothic-js/commit/ca02c59, https://github.com/kothic/kothic-js/commit/3875b6e, https://github.com/kothic/kothic-js/commit/2d563f5
70. https://github.com/kothic/kothic-js/commit/b5de689, ref-repos/kothic__kothic-js/src/renderer/path.js
71. https://github.com/vasturiano/globe.gl/commit/2d6197f, https://github.com/vasturiano/globe.gl/commit/36c6686, https://github.com/vasturiano/globe.gl/commit/4d47b41, ref-repos/vasturiano__globe.gl/README.md
72. https://github.com/vasturiano/globe.gl/issues/25, https://github.com/vasturiano/globe.gl/commit/4ab22ec
73. https://github.com/iTowns/itowns/pull/2803, https://github.com/iTowns/itowns/issues/2627
74. https://github.com/iTowns/itowns/commit/133a85b7
75. ref-repos/TerriaJS__terriajs/packages/terriajs/CHANGES.md (8.1.x geojson-vt, 8.1.12, 8.8.0, 8.8.1), ref-repos/TerriaJS__terriajs/packages/terriajs/lib/Map/Vector/Protomaps/mapboxStyleJsonToProtomaps.ts
76. https://github.com/TerriaJS/terriajs/issues/1275
77. https://github.com/TerriaJS/terriajs/commit/b456ee2e3
78. https://github.com/pelicanmapping/osgearth/issues/1062
79. https://github.com/pelicanmapping/osgearth/commit/856b64cd5, https://github.com/pelicanmapping/osgearth/commit/491a1b8da
80. https://github.com/pelicanmapping/osgearth/commit/6142a7c30, https://github.com/pelicanmapping/osgearth/commit/84fb20381, https://github.com/pelicanmapping/osgearth/commit/63074832b, https://github.com/pelicanmapping/osgearth/commit/ebec182bf
81. https://github.com/mapnik/mapnik/blob/master/CHANGELOG.md, https://github.com/mapnik/mapnik/issues/1116, https://github.com/mapnik/mapnik/issues/2000, https://github.com/mapnik/mapnik/issues/3909
82. https://github.com/mapnik/mapnik/blob/master/CHANGELOG.md, https://github.com/mapnik/mapnik/issues/927, https://github.com/mapnik/mapnik/issues/2202, https://github.com/mapnik/mapnik/pull/3160
83. ref-repos/mapnik__mapnik/docs/line-dashoffset.md, https://github.com/mapnik/mapnik/blob/master/docs/line-dashoffset.md
84. https://github.com/mapnik/mapnik/issues/2937, https://github.com/mapnik/mapnik/issues/2441
85. https://github.com/mapnik/mapnik/commit/cdb075f75, https://github.com/mapnik/mapnik/commit/721143631, https://github.com/mapnik/mapnik/commit/c3dae0105, https://github.com/mapnik/mapnik/commit/3db39f2b7, https://github.com/mapnik/mapnik/commit/c1d124f6d
86. https://github.com/mapnik/mapnik/commit/8e11ef3fd, https://github.com/mapnik/mapnik/commit/8a0dca38a
87. https://github.com/mapnik/mapnik/commit/2dde0eb25
88. https://github.com/mapnik/mapnik/commit/195947172, https://github.com/mapnik/mapnik/pull/4590
89. ref-repos/MapServer__MapServer/HISTORY.md (4.6.0-beta1), ref-repos/MapServer__MapServer/src/mapprimitive.cpp
90. https://github.com/MapServer/MapServer/issues/179
91. https://github.com/MapServer/MapServer/commit/bc06ff51, https://github.com/MapServer/MapServer/commit/af8924bb
92. https://github.com/MapServer/MapServer/commit/7f974252, https://github.com/MapServer/MapServer/commit/b59298e0, https://github.com/MapServer/MapServer/commit/af9f3986
93. https://github.com/MapServer/MapServer/commit/cbc029d4, https://github.com/MapServer/MapServer/commit/f5e1bec9, https://github.com/MapServer/MapServer/commit/8b61e099, https://github.com/MapServer/MapServer/commit/6a4adf69, https://github.com/MapServer/MapServer/commit/d231a752
94. https://github.com/geoserver/geoserver/commit/f9ebc20555
95. https://github.com/geoserver/geoserver/commit/0be7fbd168
96. https://github.com/geoserver/geoserver/commit/8172a469cd6a8aa6bec298da830a5aca6274c159
97. https://github.com/osmandapp/OsmAnd-core/pull/1138, https://github.com/osmandapp/OsmAnd-core/pull/1137, https://github.com/osmandapp/OsmAnd-core/commit/5f43bb9e, ref-repos/osmandapp__OsmAnd-core/src/Map/VectorLine_P.cpp
98. https://github.com/osmandapp/OsmAnd-core/pull/1098
99. https://github.com/osmandapp/OsmAnd-core/commit/941f1863, https://github.com/osmandapp/OsmAnd-core/commit/3fe5bbc2, https://github.com/osmandapp/OsmAnd-core/commit/3209f9b1
100. https://github.com/osmandapp/OsmAnd-core/commit/2c2ad3e31ea50c6461ad978a5d4a8c915dda5a1e, https://github.com/osmandapp/OsmAnd-core/commit/a64e1efaa2ecf028dded664a6e155a77ad39857a
101. https://github.com/osmandapp/OsmAnd-core/commit/1bebd1105921aeeb8cd94e389d8f620cdf444977, https://github.com/osmandapp/OsmAnd-core/commit/3355bebe514e1b2aecb500d937e64a5137644d60, https://github.com/osmandapp/OsmAnd-core/commit/d3c195e16c48c0cbe0fbb19342d843bc596fd20d
102. https://github.com/osmandapp/OsmAnd-core/commit/8bce21910868a809850be58f42d4a5960935f3eb, https://github.com/osmandapp/OsmAnd-core/commit/3d2e273213dc51155bd61da2130ba68e0a4a9e49
103. https://github.com/organicmaps/organicmaps/pull/12692
104. https://github.com/organicmaps/organicmaps/commit/50fd9e058d, https://github.com/organicmaps/organicmaps/commit/e87099c14f
105. https://github.com/mapsforge/vtm/issues/1082, https://github.com/mapsforge/vtm/pull/1084, https://github.com/mapsforge/vtm/pull/1100
106. https://github.com/mapsforge/vtm/pull/1085, https://github.com/mapsforge/vtm/issues/1082, ref-repos/mapsforge__vtm/vtm/src/org/oscim/renderer/bucket/LineBucket.java
107. https://github.com/osmdroid/osmdroid/issues/353, https://github.com/osmdroid/osmdroid/issues/1440, https://github.com/osmdroid/osmdroid/commit/90598201
108. https://github.com/osmdroid/osmdroid/issues/725, https://github.com/osmdroid/osmdroid/issues/1528, https://github.com/osmdroid/osmdroid/commit/03e7f5fb, https://github.com/osmdroid/osmdroid/commit/674247e0, ref-repos/osmdroid__osmdroid/osmdroid-android/src/main/java/org/osmdroid/views/overlay/LinearRing.java
109. https://github.com/navit-gps/navit/commit/1d364ed6
110. https://github.com/navit-gps/navit/commit/ebabe925, https://github.com/navit-gps/navit/commit/543da9ac
111. https://github.com/galileo-map/galileo/commit/77689e7
112. https://github.com/podusowski/walkers/commit/a79e4dd, https://github.com/podusowski/walkers/commit/678f926, https://github.com/podusowski/walkers/commit/8674318
113. https://github.com/podusowski/walkers/commit/15f2dac
114. https://github.com/podusowski/walkers/commit/a476eca
115. ref-repos/SciTools__cartopy/lib/cartopy/trace.pyx, https://github.com/SciTools/cartopy/pull/2083, https://github.com/SciTools/cartopy/pull/1808
116. https://github.com/SciTools/cartopy/pull/1607, ref-repos/SciTools__cartopy/lib/cartopy/crs.py
117. skills/map-from-scratch/references/patterns.md, examples/05-tokyo-roads-native/spec.yaml, examples/05-tokyo-roads-native/roads.c, examples/02-world-population-mobile/map.ts
118. ref-repos/pygfx__pygfx/pygfx/renderers/wgpu/wgsl/line.wgsl, https://almarklein.org/line_rendering.html, https://github.com/pygfx/pygfx
