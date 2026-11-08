---
name: polygon-triangulation
description: How 33 map engines turn polygons into GPU triangles (earcut at bake or run time, stencil fill instead, ring and hole hygiene, clipping huge polygons, index layout, globe subdivision) and what they tried and reverted. Load it when a map-from-scratch renderer must fill polygons, before writing the triangulation step of bake.ts, when fills show spikes, missing or filled holes, flooded land, slivers or outlines along tile edges, or when choosing between baked triangles, stencil fill and shipping rings only.
---

# Polygon triangulation: what to bake, what to check, what to skip

A filled polygon reaches the GPU either as triangles or as a stencil trick.
Triangles need a triangulator that is fast but fragile on real data
(duplicate points, touching rings, wrong winding, thousands of holes,
rings the size of a continent), and an index buffer whose size and layout
cost bytes. Engines spent years on this: they swapped triangulators,
capped holes, moved work between threads, shipped pre-built triangles and
stopped shipping them. Most of their run-time machinery exists because a
general engine cannot trust or pre-process its input. A renderer here
can, because it triangulates once in `bake.ts` [1][2]. What still matters
is what the engines learnt about input that breaks triangulation, about
layout, and about when not to triangulate at all.

Per-engine detail, with all numbers: [references/engines.md](references/engines.md).

## Where this repo stands

- No run-time dependency is allowed. Triangulate with `kits/earcut`
  (`import earcut from '.../kits/earcut/earcut.ts'`), which returns the
  same triangles as mapbox/earcut for the same input [1][4].
  Triangulation belongs in `bake.ts` [2].
- `tools/geo.ts` `triangulatePolygon(rings)` drops a repeated closing
  vertex and passes holes by index. It does not normalise winding, clip,
  drop holes or check its output [3].
- earcut reorients every ring itself (outer ring one way, holes the
  other) and so does not depend on input winding [4]. `kits/earcut` also
  exports `deviation()`, the relative difference between polygon area
  and triangle area, and `flatten()`. Upstream's `refine()` (Lawson flips
  that remove slivers) is not ported [4].
- `kits/earcut` is upstream's algorithm step for step, with the nodes in
  typed arrays instead of one object per vertex. It is faster than
  upstream (main 934e54d and 3.2.4) on upstream's own MVT benchmark, in
  node 24 and Chrome 157, on every size class: 1.06-1.20x on MVT
  polygons, 1.05-1.95x on 20k-60k-vertex stars (`tools/earcut-bench.ts`,
  2026-11-09). What made it fast, measured: the arrays must be `const`,
  so V8 compiles them as constants. As reassigned `let`s (to grow them),
  it was 0.76-0.86x upstream; as a resizable ArrayBuffer, 0.5x. So the
  pool is fixed (8,192 nodes) and a larger input runs in a second pool
  compiled from source with `new Function`, because a second closure of
  the same function makes V8 drop the constants in the first one too
  (triangles 51 -> 119 ns). Interleaving x/y or masking indices to drop
  bounds checks was slower [4].
- 02 bakes 127,820 earcut triangles with delta-coded indices and shares
  the vertices with the border lines [5]. 07 skipped triangulation and
  fills land by per-ring fans with stencil INVERT (even-odd): 88 KB to
  43 KB gzip [6].

## Decision 1: triangles or stencil?

| | earcut at bake | stencil-then-cover |
| --- | --- | --- |
| Shipped | vertices + indices | ring vertices only |
| Per-feature colour, id picking | free (a colour or id per vertex) | needs an id buffer pass |
| Overlapping features in one layer | fine | INVERT (even-odd) cancels the overlap |
| GPU cost | one indexed draw | two passes, fill rate on large fans |

- ortho-earth fills by fans into the stencil with non-zero winding
  (NOTEQUAL 0, never even-odd) after normalising orientation, so
  overlaps equal their union. For one colour it draws only arcs whose
  net reference is non-zero, so shared borders cancel: a 370k-edge
  parcel layer went from 20-37 ms to about 2 ms a frame. Per-feature
  colours take an additive id buffer and float blending; on half float
  the id limit is 2,047 [31].
- mapsforge VTM fills with stencil INVERT by default. Lake Zurich and a
  substation inside a fence were left unfilled because polygons of one
  layer overlapped. libtess2 meshes are "slightly slower to load ... but
  should be faster to render" [101]. Over nine years VTM switched
  tessellation on and off per theme, and in 2025 hard-wired it to the
  artificial land/sea polygons only, after fixing the overlapping
  regions in the data [102].
- Even-odd versus non-zero: Mapnik's even-odd fix for holes in GeoJSON
  caused line artifacts and was partly kept back; the lasting answer was
  to fix winding in the format [86].

Choose stencil when the layer is fill-only, one or few colours, features
in it never overlap (or you dissolve them at bake, as 07 did) and bytes
dominate the budget [6][31]. Choose earcut when features carry their own
colour or id, may overlap, or are drawn many times per frame [5][101].

## Decision 2: bake triangles, or rebuild them at load?

The repo's rule is bake [2]. The one counter-measurement: MLT tiles with
pre-built triangles were 21.9 to 35.8% larger, and decoding them was
14 to 145% slower than decoding outlines (v1 27 and 145%, v2 14 and
68%; v2 triangles-only 10 and 59%) [16]. MLT's encoder now prices
each layer: transfer time per byte by network (3G 4 us/B to 5G 40 ns/B,
offline 0) against client earcut time, with a slowdown of 2 for a
mid-range phone [18]. Organic Maps stores triangle strips so phones never
triangulate [93][96]. VTS users tessellating GeoJSON in the browser found
it slow; the fix was to export the result once (55 MB JSON, 14 MB without
whitespace) [73].

So: bake triangles, delta-code the indices (02 [5]), and record bytes.
Only if a gzip budget is tight and the polygons are simple, measure
earcut at load on the throttled phone profile against the index bytes,
and write both into `performance_knowledge`.

## Decision 3: index layout

- Indexed, not a triangle soup: ortho-earth fills went 4.96 to 3.08 MB
  with `drawElements` [33].
- Width from the vertex count: iTowns picks Uint8/16/32 per mesh but
  notes Uint8 is not a fast path on every GPU [70]. maplibre-rs moved
  to u32, doubling index memory, instead of splitting buffers under
  65,536 vertices [13]. MapLibre caps globe subdivision at granularity
  128 to stay inside 16-bit indices [7].
- One buffer per layer: indices counted from the layer's first vertex
  raised index entropy by under 0.01% and made MLT's code "a lot
  simpler" [20]. Per-feature bases help only if features are drawn or
  culled one by one.
- Compressing the index stream: MLT v2 triangle trees store about 2 bits
  per triangle (0.3 B per index against 2 B); a tessellated dataset
  shrank 57.81 to 50.12 GB, decode is 7 ns per triangle, and the author
  thinks the buffer is probably no longer zero-copy to the GPU. It
  relies on earcut adding no interior vertices [17][19]. Delta coding plus gzip (02) is the cheap
  version here [5].
- Keep the rings if anything strokes or picks them. MLT's triangles-only
  layout cannot stroke outlines, and a decoder crashed on it [21];
  Organic Maps dropped area outlines and had to rework the area centre
  [96]. 02 keeps ring lengths so borders reuse the fill vertices [5].
- One mesh beats many: walkers' switch from earcut to lyon was "way
  faster", but it also went from many shapes to one mesh, and the two
  causes were never separated [107].

## Decision 4: input hygiene before earcut (checklist for bake.ts)

1. Closing vertex: decide whether rings repeat the first point and test
   it. mlt-core decoded rings with a closing point while the stored
   triangles assumed none; holes misaligned and the covered area was
   134.5 instead of 91 [10][17]. `openRing` in `tools/geo.ts` handles it
   for earcut input [3].
2. Ring roles explicit, not inferred from winding. MLT v2 takes roles
   from ring counts [17]; OpenLayers splits by winding only for MVT
   features [57]; Tangram infers the convention from the first ring of
   each source because Mapzen tiles were wound against MVT 2.1 [59];
   GeoServer had to upgrade its encoder to follow MVT 2.1 winding [85].
3. Normalise winding explicitly wherever it still matters (non-zero
   stencil, back-face culling, extruded walls, stroke offsets). Marble's
   3D walls turned inside out once its clipper stopped normalising
   winding as a side effect [52]. d3-geo's spherical convention is the
   opposite of RFC 7946, and a wrongly wound ring renders as the whole
   planet except the polygon [67].
4. Signed area: the plain sum over all edges, relative to a local
   origin. OpenLayers replaced it with a "faster" lowest-vertex test,
   patched it twice for duplicate points and reverted [56]. Mapnik's
   `is_clockwise` failed on thin rings at Web Mercator magnitudes until
   it subtracted the first vertex [81]. GRASS returned to a line
   integral as "more robust than surveyor's formula" [46], and a signed
   geodesic area routine silently skipped rings until it returned the
   absolute value [45].
5. Remove near-duplicate points in projected units first. poly2tri
   crashed on them; QGIS simplifies, then skips the polygon [37].
6. Validate after quantisation and after simplification. Tangram's
   TopoJSON water polygons (78-point outer, 21 holes) came out wrong only
   in earcut because quantisation made rings touch; the server raised
   the quantisation scale [60]. Organic Maps found outer rings that turn
   invalid at low zoom while their holes stay valid [95]. OsmAnd flooded
   St Petersburg by dropping closed coastline rings under 4 points [91].
7. After clipping, keep only pieces of the input's dimension: drop the
   points and lines a polygon clip produces [84].
8. Check the result. If earcut returns no indices, emit nothing:
   Tangram appended vertices first and drew artifacts [58]. Compare
   areas: iTowns tests meshes by area [71], and `deviation()` does it
   per polygon [4]. osgEarth's earcut needed a fix and an opt-in GLU
   fallback for bad input [76]. At bake, log the feature id and either
   repair, fall back or drop it, and count what was dropped.
9. Zero-area triangles: Organic Maps drops them with a robust
   orientation test scaled to the stored coordinate accuracy, though its
   author is unsure of the constant [99].

## Decision 5: very large polygons

- Thousands of holes: MapLibre keeps the 500 largest rings per polygon
  (first 100) with quickselect, because earcut slows with ring count [8].
  Tangram copied the cap, but no code sets the ring `.area` its
  comparator reads, so its selection is arbitrary [63]. Here, drop holes
  below the smallest visible area at the bake's target zoom and count
  them.
- Huge rings: cut into cells before triangulating. osgEarth crops
  polygons to a grid before tessellation [74]. Organic Maps tessellated
  whole continents with their lakes and reverted it two days later,
  keeping coast cells split by 4 and a 10,000-point limit [97]. Navit
  slices polygons that would sit above tile level 4 into squares [103].
- Clip with a rectangle clipper: GeoServer clips to an envelope, robust
  first, non-robust on exception [83]. MapServer's rectangle clip emits
  up to 3 points per input edge; 2 per edge overflowed [82]. Marble
  clips in 1e-7-degree integers [48] and replaced its own
  Weiler-Atherton with Clipper for robustness [49]. harp.gl moved
  clipping from 4 shader clip planes back to the decoder [65].
- Clip edges are not borders. QGIS drops edges on the chunk perimeter
  [40]; kothic-js skips segments between two points on the same tile
  edge [66]; mapsforge documents a tile-grid artifact for stroked areas
  [100]; Navit's sliced polygons render "checkered" when outlined [103].
  Bake borders as lines from the unclipped rings.
- Simplification does not cut triangles proportionally: Organic Maps
  notes a circle simplified from 50 to 10 points does not give 5 times
  fewer triangles [93]. Count triangles per zoom level.
- Extruded buildings stay whole: Organic Maps clips areas by tile but
  not building triangles [98].

## Decision 6: projections other than the baked flat one

- Projected at bake (Equal Earth, local grid) and drawn with an affine
  camera: triangulate in projected coordinates; nothing below applies
  [2][5].
- Projected on the GPU (globe): subdivide earcut's output on a fixed
  square grid so neighbours match; MapLibre found this the fastest
  approach and warns of single-pixel seams [7]. globe.gl subdivides by
  an angular step and halved its default from 10 to 5 degrees after
  making generation faster [69]. Cesium triangulates small polygons in a
  tangent plane and spans of 180 degrees or more in a stereographic or
  cylindrical plane, split at the equator [26].
- Precision: tessellate in tile or local units. RustGIS strokes broke in
  map units [22]; QGIS roofs and walls lost precision until it subtracted
  an origin in double first [36].

## If triangulation must happen at run time

Only for user-supplied or editable geometry.

- In the thread that already parses the data: deck.gl rejected a second
  worker because the data would cross threads twice [28][29].
- Only the layers the style draws [14]; estimate vertices before
  tessellating (1.5M tiny polygons became 30-50M vertices) [23].
- Flat arrays, no per-vertex objects or coordinate-keyed maps:
  MapLibre's array remap made its bench about 15% faster [9]; cartopy's
  single coordinate extraction was 50-100x faster [108]. If you hash
  quantised coordinates, mix the bits: 161 s to 13 s [34].
- Not WASM per polygon: the call frequency and small payload cancel the
  gain [30].
- Decode MVT commands yourself; SVG path semantics differ [15].

## Tried and reverted

| Engine | Tried | Outcome |
| --- | --- | --- |
| OpenLayers | own robust ear clipper, 40x slower than earcut at first [53] | new WebGL renderer uses earcut in a worker [53] |
| OpenLayers | fast lowest-vertex winding test [56] | back to the signed-area sum [56] |
| Organic Maps | triangulating whole continents [97] | reverted in two days, coast cells [97] |
| harp.gl | tile clipping in the fragment shader [65] | CPU clipping in the decoder [65] |
| mapsforge VTM | tessellation per theme, on and off [102] | only land/sea, overlaps fixed in data [102] |
| Mapnik | Clipper, boost.geometry, own clipper [80] | simple AGG clipper for drawing [80] |
| osgEarth | own ear clipper, then earcut [75][76] | earcut with GLU fallback [76] |
| OsmAnd | dropping off-screen polygon vertices [92] | full geometry for areas [92] |
| MLT | compact triangle trees [19] | author: "As networks get faster, we might need to revert" [19] |

## Sources

Paths are relative to the repository root; `ref-repos/<owner>__<repo>/` is
the local clone.

1. README.md
2. skills/map-from-scratch/SKILL.md; skills/map-from-scratch/references/patterns.md
3. tools/geo.ts
4. kits/earcut/earcut.ts; kits/earcut/earcut.test.ts; tools/earcut-bench.ts
5. examples/02-world-population-mobile/spec.yaml; examples/02-world-population-mobile/REQUEST.md
6. examples/07-world-cities-hover/spec.yaml
7. ref-repos/maplibre__maplibre-gl-js/developer-guides/globe.md
8. https://github.com/maplibre/maplibre-gl-js/commit/3d39142e4; ref-repos/maplibre__maplibre-gl-js/src/data/bucket/fill_bucket.ts
9. https://github.com/maplibre/maplibre-gl-js/commit/761f0f3d6
10. https://github.com/maplibre/maplibre-native/pull/4428
11. https://github.com/maplibre/maplibre-native/commit/fb37f5e54; https://github.com/maplibre/maplibre-native/commit/8552d6312
12. https://github.com/maplibre/maplibre-rs/blob/main/maplibre/src/lib.rs; ref-repos/maplibre__maplibre-rs/docs/src/development-documents/figures/data-model.drawio.svg
13. https://github.com/maplibre/maplibre-rs/commit/1b4eada
14. https://github.com/maplibre/maplibre-rs/commit/635df81; https://github.com/maplibre/maplibre-rs/commit/b30beb8; https://github.com/maplibre/maplibre-rs/commit/37a2953
15. https://github.com/maplibre/maplibre-rs/commit/e6f3b18
16. https://github.com/maplibre/maplibre-tile-spec/blob/main/docs/benchmarks.md; ref-repos/maplibre__maplibre-tile-spec/docs/benchmarks.md; https://github.com/maplibre/maplibre-tile-spec/blob/main/rust/mlt-core/CHANGELOG.md; ref-repos/maplibre__maplibre-tile-spec/rust/mlt-core/CHANGELOG.md
17. https://github.com/maplibre/maplibre-tile-spec/blob/main/docs/specification/v2.md; ref-repos/maplibre__maplibre-tile-spec/docs/specification/v2.md
18. https://github.com/yuiseki/maplibre-tile-spec/commit/a7eac51d; https://github.com/yuiseki/maplibre-tile-spec/commit/85684b59
19. https://github.com/yuiseki/maplibre-tile-spec/commit/8c8b4d64; https://github.com/yuiseki/maplibre-tile-spec/commit/1cdc94a6
20. https://github.com/yuiseki/maplibre-tile-spec/commit/211c4124
21. https://github.com/yuiseki/maplibre-tile-spec/commit/364a9852; https://github.com/yuiseki/maplibre-tile-spec/commit/2deacaa4
22. https://github.com/opengeos/RustGIS/commit/d724d89; https://github.com/opengeos/RustGIS/commit/9f318db
23. https://github.com/opengeos/RustGIS/commit/57036b6
24. ref-repos/CesiumGS__cesium/CHANGES.md; https://github.com/CesiumGS/cesium/issues/2788; https://github.com/CesiumGS/cesium/pull/10593
25. https://github.com/CesiumGS/cesium/commit/a2b4e3498; https://github.com/CesiumGS/cesium/commit/e55aa7ea1; https://github.com/CesiumGS/cesium/commit/483644a97
26. https://github.com/CesiumGS/cesium/commit/3033b0c1e543fba30fdc8e32395d34d81e34d7b8; https://github.com/CesiumGS/cesium/commit/b6c35bd710e1e6c7e14561f758832eb5f15a8b5e
27. https://github.com/visgl/deck.gl/commit/9c40fa60; https://github.com/visgl/deck.gl/commit/91534412
28. https://github.com/visgl/deck.gl/commit/bacb7c24; https://github.com/visgl/deck.gl/commit/0275d745; https://github.com/visgl/deck.gl/commit/8746716d; ref-repos/visgl__deck.gl/dev-docs/RFCs/proposals/loader-worker-triangulation.md
29. https://github.com/visgl/deck.gl/commit/2c31fb13; https://github.com/visgl/deck.gl/commit/7643eea0
30. https://github.com/kenjiyoshidahome2026-bit/ortho-earth/blob/main/packages/ortho-core/perf%20survey.md; ref-repos/kenjiyoshidahome2026-bit__ortho-earth/packages/ortho-core/perf survey.md; ref-repos/kenjiyoshidahome2026-bit__ortho-earth/packages/ortho-core/perf plan.md
31. https://github.com/kenjiyoshidahome2026-bit/ortho-earth/blob/main/packages/ortho-core/gint%20draw%20spec.md; ref-repos/kenjiyoshidahome2026-bit__ortho-earth/packages/ortho-core/gint draw spec.md; ref-repos/kenjiyoshidahome2026-bit__ortho-earth/packages/ortho-core/webgpu port.md
32. https://github.com/kenjiyoshidahome2026-bit/ortho-earth/commit/82c17eb6
33. https://github.com/kenjiyoshidahome2026-bit/ortho-earth/commit/c8febdff
34. https://github.com/kenjiyoshidahome2026-bit/ortho-earth/commit/f125c3c2
35. https://github.com/qgis/QGIS/pull/58583; https://gdal.org/en/latest/development/rfc/rfc64_triangle_polyhedralsurface_tin.html
36. https://github.com/qgis/QGIS/commit/042bf97336; https://github.com/qgis/QGIS/commit/5b74bdfe21; https://github.com/qgis/QGIS/commit/59fa541bc0
37. https://github.com/qgis/QGIS/commit/7bce7ea9ca; https://github.com/qgis/QGIS/commit/35b37a228f; https://github.com/qgis/QGIS/commit/b773d617b1
38. https://github.com/qgis/QGIS/commit/9b07075fae; https://github.com/qgis/QGIS/commit/800c54fc91; https://github.com/qgis/QGIS/commit/6bc298456b
39. https://github.com/qgis/QGIS/commit/577e1e962d; https://github.com/qgis/QGIS/commit/04ca01a795; https://github.com/qgis/QGIS/commit/8adc498421; https://github.com/qgis/QGIS/commit/efcc9c5240
40. https://github.com/qgis/QGIS/commit/13d03b559a
41. https://github.com/qgis/QGIS/commit/a0d9093889; https://github.com/qgis/QGIS/commit/be4ccb5c66
42. https://github.com/qgis/QGIS/commit/127fabd093; https://github.com/qgis/QGIS/commit/434e7028dc; https://github.com/qgis/QGIS/commit/40df5696b5
43. ref-repos/OSGeo__grass/lib/vector/vectorlib_topology.dox; ref-repos/OSGeo__grass/lib/vector/vectorlib_ogr.dox; ref-repos/OSGeo__grass/doc/vector/TODO
44. ref-repos/OSGeo__grass/lib/symbol/README
45. https://github.com/OSGeo/grass/pull/1283
46. https://github.com/OSGeo/grass/commit/d780df670
47. https://github.com/OSGeo/grass/commit/c5755a9354e6c9e0355688b0b45259aa41dfb70d; https://github.com/OSGeo/grass/commit/6246b5a0a683d2ba6262eccf1952f691d778ec9d
48. ref-repos/KDE__marble/tools/vectorosm-tilecreator/VectorClipper.h; https://invent.kde.org/education/marble/-/blob/master/tools/vectorosm-tilecreator/VectorClipper.h
49. https://github.com/KDE/marble/commit/89a0e9010; https://github.com/KDE/marble/commit/342aa8041; https://github.com/KDE/marble/commit/1e879be7b
50. https://github.com/KDE/marble/commit/75fe1f3d2; https://github.com/KDE/marble/commit/73c4289d2
51. https://github.com/KDE/marble/commit/bfd575312
52. https://github.com/KDE/marble/commit/d3c923f75; https://github.com/KDE/marble/commit/48c412ef1
53. https://github.com/openlayers/openlayers/pull/5462#issuecomment-246985147; https://github.com/openlayers/openlayers/pull/13461
54. https://github.com/openlayers/openlayers/pull/5462
55. https://github.com/openlayers/openlayers/commit/87a10200e; https://github.com/openlayers/openlayers/commit/a0089b512; https://github.com/openlayers/openlayers/commit/dc27f768d
56. https://github.com/openlayers/openlayers/commit/c490745ff; https://github.com/openlayers/openlayers/commit/f2b790adf; https://github.com/openlayers/openlayers/commit/c1a547a9a
57. https://github.com/openlayers/openlayers/commit/1361a7907; https://github.com/openlayers/openlayers/commit/4c58b9788
58. https://github.com/tangrams/tangram/pull/651
59. https://github.com/tangrams/tangram/pull/241
60. https://github.com/tangrams/tangram/issues/456
61. https://github.com/tangrams/tangram/commit/f6e3537e; https://github.com/tangrams/tangram/commit/5e7686d4
62. https://github.com/tangrams/tangram/commit/ee3c3706; https://github.com/tangrams/tangram/commit/44b34bcd
63. https://github.com/tangrams/tangram/commit/d0b887d09a3645aad91a18bd3bd0362d74627da3; ref-repos/tangrams__tangram/src/builders/polygons.js
64. https://github.com/tangrams/tangram-es/commit/eea679cc; https://github.com/tangrams/tangram-es/commit/63019355; https://github.com/tangrams/tangram-es/issues/1639
65. https://github.com/heremaps/harp.gl/commit/9fcdb8a0; https://github.com/heremaps/harp.gl/commit/73d457a1; https://github.com/heremaps/harp.gl/commit/6665f189; https://github.com/heremaps/harp.gl/commit/93197f27
66. https://github.com/kothic/kothic-js/commit/b5de689; ref-repos/kothic__kothic-js/src/renderer/path.js
67. https://github.com/d3/d3-geo/issues/138; https://github.com/d3/d3-geo/issues/140; https://github.com/d3/d3-geo/blob/18eb2fb/README.md
68. https://github.com/d3/d3-geo/commit/ed81279
69. https://github.com/vasturiano/globe.gl/commit/2d6197f; https://github.com/vasturiano/globe.gl/commit/36c6686; https://github.com/vasturiano/globe.gl/commit/4d47b41; ref-repos/vasturiano__globe.gl/README.md
70. https://github.com/iTowns/itowns/commit/378c092; https://github.com/iTowns/itowns/commit/06c7181
71. https://github.com/iTowns/itowns/pull/691
72. https://github.com/iTowns/itowns/pull/195
73. https://github.com/melowntech/vts-browser-js/issues/179; https://github.com/melowntech/vts-browser-js/commit/a557f84; ref-repos/melowntech__vts-browser-js/src/core/map/geodata-import/vts-geodata.js
74. https://github.com/pelicanmapping/osgearth/commit/0a6b0a5be4df33d91dce0b1d0669b037d8b2e42e; https://github.com/pelicanmapping/osgearth/commit/0e1e4bca4775e28307b7db26e0b9db751c5b7d9e
75. https://github.com/pelicanmapping/osgearth/commit/bc7678ab590ce1d4f7800f0d23475861866767e8; https://github.com/pelicanmapping/osgearth/commit/1882da8c16d60945bd93af56ae5fb13b0a712d07
76. https://github.com/pelicanmapping/osgearth/commit/46b784681; https://github.com/pelicanmapping/osgearth/commit/ec9bad79b; https://github.com/pelicanmapping/osgearth/commit/e762c2744
77. https://github.com/pelicanmapping/osgearth/commit/10c588a0b; https://github.com/gwaldron/osgearth/issues/1440
78. https://github.com/pelicanmapping/osgearth/commit/a285cd919
79. https://github.com/mapnik/mapnik/blob/master/CHANGELOG.md; https://github.com/mapnik/mapnik/issues/2739
80. https://github.com/mapnik/mapnik/commit/4bdc5cdc1; https://github.com/mapnik/mapnik/commit/a8d49b811; https://github.com/mapnik/mapnik/commit/cf784f5e2; https://github.com/mapnik/mapnik/commit/775fcb537; https://github.com/mapnik/mapnik/commit/a138b8717
81. https://github.com/mapnik/mapnik/commit/34d96f3ef; https://github.com/mapnik/mapnik/commit/ce291a553; https://github.com/mapnik/mapnik/commit/66160e975
82. https://github.com/MapServer/MapServer/commit/40624a2b
83. https://github.com/geoserver/geoserver/commit/f4eeb55439
84. https://github.com/geoserver/geoserver/commit/712e52963f
85. https://github.com/geoserver/geoserver/commit/f363bb4987
86. https://github.com/tilemill-project/tilemill/issues/2110
87. https://github.com/osmandapp/OsmAnd-core/pull/1138; https://github.com/osmandapp/OsmAnd-core/pull/1137
88. https://github.com/osmandapp/OsmAnd-core/pull/280; https://github.com/osmandapp/OsmAnd-core/pull/365; https://github.com/osmandapp/OsmAnd-core/pull/1094
89. https://github.com/osmandapp/OsmAnd-core/commit/2d924177
90. https://github.com/osmandapp/OsmAnd-core/commit/41c5a7cf2e396b33dd2fa6d61471f2d3f9d222b4
91. https://github.com/osmandapp/OsmAnd-core/commit/e0099eabaefbe3864cc0e5d37afad91af3dc19b5
92. https://github.com/osmandapp/OsmAnd-core/commit/0753b344; https://github.com/osmandapp/OsmAnd-core/commit/61fff9af; https://github.com/osmandapp/OsmAnd-core/commit/1501163d; https://github.com/osmandapp/OsmAnd-core/commit/375a2025
93. ref-repos/organicmaps__organicmaps/generator/feature_sorter.cpp; ref-repos/organicmaps__organicmaps/libs/indexer/feature.hpp; https://github.com/organicmaps/organicmaps/blob/master/generator/feature_sorter.cpp
94. https://github.com/organicmaps/organicmaps/pull/13253
95. https://github.com/organicmaps/organicmaps/pull/6537
96. https://github.com/organicmaps/organicmaps/commit/bfcb154531; https://github.com/organicmaps/organicmaps/commit/50cafffc72; https://github.com/organicmaps/organicmaps/commit/9d5595ca7e; https://github.com/organicmaps/organicmaps/commit/5b533632a6; https://github.com/organicmaps/organicmaps/commit/3f869a3c19; https://github.com/organicmaps/organicmaps/commit/776c5b3fa7; https://github.com/organicmaps/organicmaps/commit/1a03b05f71
97. https://github.com/organicmaps/organicmaps/commit/bf52883265; https://github.com/organicmaps/organicmaps/commit/3ba0b12968; https://github.com/organicmaps/organicmaps/commit/820a59c8f0; https://github.com/organicmaps/organicmaps/commit/d6106655de; https://github.com/organicmaps/organicmaps/commit/02be5af144
98. https://github.com/organicmaps/organicmaps/commit/cf0b75e26a; https://github.com/organicmaps/organicmaps/commit/40e5f2ecfa; https://github.com/organicmaps/organicmaps/commit/23cba423c3; https://github.com/organicmaps/organicmaps/commit/01835487d0; https://github.com/organicmaps/organicmaps/commit/750c7bf1ab
99. https://github.com/organicmaps/organicmaps/commit/af2fb3ff9768c6109887f4d82d0201e7628543c1; https://github.com/organicmaps/organicmaps/commit/e2051d71c2a71d8bb7077769bca3cb0cdb886903
100. ref-repos/mapsforge__mapsforge/docs/Getting-Started-Map-Writer.md
101. https://github.com/mapsforge/vtm/issues/224; ref-repos/mapsforge__vtm/vtm/src/org/oscim/renderer/bucket/PolygonBucket.java; ref-repos/mapsforge__vtm/vtm/src/org/oscim/renderer/bucket/MeshBucket.java
102. https://github.com/mapsforge/vtm/commit/892ea925802e1805d309ca33e710c56388031324; https://github.com/mapsforge/vtm/pull/1202; https://github.com/mapsforge/vtm/pull/1207; https://github.com/mapsforge/vtm/pull/903; https://github.com/mapsforge/vtm/issues/224
103. https://github.com/navit-gps/navit/pull/906; https://github.com/navit-gps/navit/commit/b99187ee
104. https://github.com/navit-gps/navit/commit/1d364ed6
105. https://github.com/navit-gps/navit/commit/d95d2c11; https://github.com/navit-gps/navit/commit/8bf234d5; https://github.com/navit-gps/navit/commit/47f9ecef; https://github.com/navit-gps/navit/commit/df2c55b4
106. https://github.com/galileo-map/galileo/issues/41
107. https://github.com/podusowski/walkers/pull/418
108. https://github.com/SciTools/cartopy/pull/2693; ref-repos/SciTools__cartopy/lib/cartopy/mpl/path.py
