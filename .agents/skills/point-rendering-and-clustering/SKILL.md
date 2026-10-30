---
name: point-rendering-and-clustering
description: How map engines draw many point features (markers, circles, dots, point clouds) and reduce them (clustering, aggregation, thinning, sampling, point budgets), with the trade-offs and numbers they recorded. Load it when a map-from-scratch request has thousands or more points, POIs, markers, vehicles or LiDAR/point clouds, asks for clusters, hexbins, grids or heatmaps, says "show every point" or "points must not overlap", or when choosing how to draw a circle marker, hide or filter points, or cap points per view.
---

# Point rendering and clustering

A point layer is cheap per feature and expensive in bulk. Engines kept
finding the same four costs: a collision or placement step run for every
symbol whether or not anything can be culled; a draw call, path or object
per point; fragments, which grow with marker radius, overlap and device
pixel ratio; and objects or buffers rebuilt when only a few values changed.
The reductions (clusters, aggregates, samples, budgets) each lose something
different: counts, completeness or stability under zoom. This skill
collects what 27 engines decided. Per-engine detail, with more numbers, is in
[references/engines.md](references/engines.md). The local examples already
cover additive density (04), points that appear over time (03) and a few
thousand hoverable circles (07); `skills/map-from-scratch/references/patterns.md`
has the stride and id-picking patterns, which are not repeated here.

## Decide first: is overlap allowed, and must every point be visible?

Write the answer into `spec.yaml` `architecture_selection.not_doing`
before any code. It selects the whole design:

| The request says | Choose | Loses |
| --- | --- | --- |
| show density, many points | aggregate (count per pixel, grid, hexbin, heatmap) [12][14] | individual points |
| show every point, overlap is fine | instanced quads or `POINTS`, no collision pass [1][56][58] | readability where dense |
| points must not overlap, readable markers | clusters per zoom, baked [27][31] | exact positions at low zoom |
| keep the important ones only (peaks, cities) | bake-time selection by an importance attribute [27][26] | the rest at low zoom |
| too much data to load at all | even sample or point budget per view [5][6][23] | completeness of a zoomed-out view |
| labels must not collide | collision for labels only, never for plain dots [14][20] | nothing for the dots |

When a collision-filtered scatterplot was proposed as deck.gl's showcase
for collision filtering, the maintainer called the scatterplot case
"relatively weak": overlapping points are usually shown as a heatmap or
clusters, "by aggregation, not reduction". Another reviewer said the
feature was built for labelling, and the example was merged after being
redirected to road labels [14].

## Drawing many points

**Skip placement and collision for points that are always drawn.**
MapLibre's large-data guide names overlap checking as the expensive part
and recommends allow-overlap, clustering, a GeoJSON source `maxzoom` of
about 12 and layer `minzoom` above 0 [1]. Mapnik added a `dot` symbolizer
that draws a filled ellipse per point and bypasses the marker pipeline
(placement, collision, SVG) [56]. TileMill's auto-style adds
`marker-ignore-placement` next to `marker-allow-overlap`, because
allow-overlap alone still inserts every marker into the collision index
[58]. QGIS cut render time of point layers by about 60% by registering
features as label obstacles only when the layer has a label or diagram
provider [20]. Where collision is needed, Tangram builds a uniform grid
only when the busiest tile has enough labels, so sparse basemap scenes pay
nothing [34].

**A circle is a quad and a fragment test, not a polygon.** deck.gl's
ScatterplotLayer went from an instanced 16-sided fan with `LINE_LOOP`
outlines to a unit square per instance whose fragment shader discards
outside the radius: "about 3x faster", and outline widths became correct
because `gl.lineWidth` was no longer used [16]. OpenLayers added a WebGL
circle replay with a distance test instead of triangulation; the new batch
type changed Canvas draw order and broke rendering tests [28]. Tangram
draws fill and outline in one quad, with smoothstep coverage from one
`length()` and no branch, and pads the quad in the vertex shader so edge
pixels are still rasterised; a "+1px" outline bump turned out to be the
cause of oversized outlines and was removed [33]. In osgEarth, round
(`smooth`) points vanished inside a Qt widget until a 3.3 context was
requested; a contributor noted the rasterised shape of points is undefined
in some configurations, so round points need a fragment shader [52].
Galileo has no real-radius circle: its maintainer suggested a symbol that
draws the point as an approximating polygon, said skipping tessellation
"for simple shapes like circles ... shouldn't really matter", and planned
an `Arc` primitive; a user's workaround used 50 geodesic points [60]. Examples 03 and 07 here
already use `gl.POINTS` with a `gl_PointCoord` discard [63].

**WebGPU Compute Shader with Subgroups replaces point raster blending.**
For massive point density (1,000,000+ points), WebGL2 additive point blending (04)
suffers from severe ROP serialization unless points are CPU-scrambled with Morton strides.
With WebGPU compute shaders (`enable subgroups;`), points reside in a storage buffer.
Compute threads map points to screen-space grid cells and accumulate via `atomicAdd` and `atomicMax`,
reducing memory contention across SIMD lanes. A million points can be binned and auto-exposed
in 0.2 ms on the GPU, completely eliminating CPU aggregation and point-drawing passes (`webgpu-003-subgroup-density`).

**Instance; do not build an object per point.** navara's
`InstancedPointMesh` and `InstancedBillboardMesh` did not actually use
instancing; real instancing fixed flicker and picking, but the port
regressed per-instance aspect ratio, colour and debug-page visibility,
caught only in review [3]. iTowns draws point features styled with a 3D
model as one `InstancedMesh` per model part [42]; osgEarth moved instance
transforms from UBOs to matrix textures to texture buffers, packing the
pick id into the spare matrix column [54]. Raw WebGL can interleave with a
byte stride; three.js could not express a 5-byte point record, so iTowns
kept each point-cloud attribute in its own buffer [39].

**Fragments, not vertices, are the bill when points are large or dense.**
A 5 px radius scatterplot point is about 100 fragments; 10 million points
can reach a billion fragment invocations per frame [13]. Rendering below
full device pixel ratio cuts the framebuffer up to 4x on retina phones
with little visible loss [13]. Example 04 found the same in another form:
blending into one pixel back to back dominated the all-in-view frame [63].

**CPU renderers: stamp, do not path.** RustGIS drew a tiny-skia path per
point (about 5 us each, 600 ms a frame for 100k points); stamping each
marker from a sprite cached per quarter-pixel offset (at most 1024 sprites,
about 10 MB) made it 10-14x faster [7]. QGIS replaced `setPen` and
`drawPoint` with `fillRect` squares and turned anti-aliasing off for point
clouds: "orders of magnitude faster", at the cost of round points [22].
d3-geo caches the SVG circle sub-path while the radius is constant [36].
Cesium rounded point pixel sizes to integers because sampled float sizes
had generated thousands of canvases [10]. TerriaJS replaced image
billboards with plain points (5 px, 1 px outline) for CSV data to speed up
Leaflet [46]. QGIS draws vertex markers from the point array already
projected and simplified for the line or fill, rather than transforming
the vertices again [21].

**Hiding and filtering points.**
- Do not collapse hidden vertices to one clip position. Cesium computed
  `gl_Position = show * positionClip` and hit a severe slowdown on some
  hardware; it now passes `show` to the fragment shader and discards, with
  a comment "Important NOT to compute" the old form [11]. Hidden points
  still cost vertex and raster work, so filter at bake time where you can
  [11]. Example 03 hides points differently: outside the clip volume with
  `gl_PointSize = 0` [63]; that is not the `w = 0` case Cesium hit, and it
  has not been compared with discard here.
- Drive class visibility from a lookup, not from vertex data. iTowns moved
  per-class visibility to a 256x1 texture read in the vertex shader and
  removed the fragment discard on vertex alpha 0; the price was that all
  points became transparent with depth writes off, and later fixes for
  depth and transparency with terrain followed [37].
- Compile filters and styles to typed code. QGIS parses point-cloud
  filters with its general expression parser, then compiles supported
  nodes to typed per-point nodes, because per-point variant evaluation was
  "simply too slow"; unsupported expressions are errors, with no slow
  fallback [18]. Cesium transpiles point-cloud style expressions to GLSL,
  which forced stricter operator types and a shader recompile per style
  change [9].
- Hidden must mean hidden everywhere. In vts-browser-js, back-face
  culling hid labels and icons but not points, and alpha-0 points stayed
  clickable from the far side of the globe [50]; iTowns had a performance
  bug from point nodes marked not visible but still drawn [43].

**Retained scene graphs (DOM, SVG, Leaflet, entity systems).** reearth
switches a GeoJSON layer from one component per feature to Cesium's bulk
loader above 6,000 features [8]. Leaflet's drag start was slow on maps with
many elements because a class on `<body>` forced style recalculation [32].
TerriaJS made 2D points and polygons "drastically faster" by updating a
Leaflet layer only when its position or style changed [45], and does the
same per vehicle id for realtime GTFS [47]. A canvas or WebGL renderer
redraws anyway; for moving points, keep one instance slot per id and write
only changed fields [47].

## Reducing points

**Clustering.** Leaflet.markercluster clusters greedily at the maximum
zoom, then clusters the clusters for each zoom upward into a tree, with a
distance grid so each marker is compared only with its own and neighbouring
cells [31]. MapLibre's GeoJSON clustering defaults to a 50 px radius [1];
OpenLayers 2 used 20 px plus a threshold below which clusters show their
members [30]. MapServer added a greedy `SIMPLE` algorithm beside its
rank-based `FULL` one: faster, order-dependent [57]. osmdroid replaced grid
clustering with radius clustering to avoid clusters split by grid lines
[59]. osgEarth replaced a radius query with a box query because it is
"much faster", making neighbourhoods square [55]; walkers rebuilt
clustering on an R-tree, "considerably faster" [61]. Marble clusters
mountain peaks within 3 km with DBSCAN in the tile creator and shows only
the highest of each cluster from level 11, the rest from 13 [27].

**Aggregation.** deck.gl measured CPU against GPU grid aggregation: 25K
points 535 vs 359 iterations/s (GPU 33% slower), 100K 119 vs 437, 1M 12.7
vs 158 [12]. GPU memory grows with all possible cells, CPU memory with
non-empty cells; GPU results differ slightly (float32), and quantile or
ordinal scales need read-back [12]. GPU is now the default
(`gpuAggregation: true`); CPU is the fallback when the browser lacks
support, under WebGPU, or when a custom aggregator or value accessor is
set [12].
deck.gl later refactored aggregation behind one CPU/GPU interface that does
not know the input format or projection [15]. GRASS bins point clouds with
Neumaier compensated sums and Welford variance for stability when many
points fall in one cell [25]. `Math.min.apply` over a large array overflowed
the stack in deck.gl's aggregator; use a loop [17].

**Thinning, sampling and budgets.**
- RustGIS shows an evenly spread sample when a view holds more features
  than a cap (250,000 local / 100,000 browser; 60,000 / 30,000 remote), with
  a tooltip saying so [5]; streamed layers re-read a window padded by half
  a view [6]. A 183,000-feature view of 1.6M polygons read in 0.15 s [5].
- osgEarth orders placements so that a prefix is a valid lower density:
  raising density appends, nothing pops [51]. Its thinning rank reused the
  hash that also set the cell-local X coordinate, so keeping 20% kept the
  westernmost 20% of each cell (visible bands); a separately salted hash
  fixed it, and a 4x4-grid spatial test failed all 128 checks on the old
  rank [51]. Merged symbols are weighted by footprint area, not member count,
  so dense bakes do not open gaps [51].
- Point budgets are only as exact as their nodes: QGIS set the minimum to
  100,000 because whole nodes load [23]; iTowns uses a per-node fraction
  for evenly spread formats and importance order for Potree [40].
- Pre-cull what can never fit: iTowns drops labels at tile load that cannot
  fit the tile's largest screen footprint [41]; osgEarth caps how many
  labels the declutter sort considers [53].
- Thinning symbols to an even screen grid (wind arrows): cartopy builds
  the regular grid in the target projection, maps it back and
  interpolates in the source CRS, a behaviour change that broke 4 tests
  [62].

## Tried and reverted

- deck.gl added separate `GPUGridLayer`/`CPUGridLayer` classes in v7.1 and
  removed them in v9.1 in favour of `GridLayer` with `gpuAggregation` [12].
- OpenLayers deleted its general WebGL renderer (7,738 lines) and kept a
  thin helper plus a points layer, the one job where WebGL won [29].
- QGIS first wrote a separate lexer and parser for point-cloud filters,
  then dropped it for the shared parser plus compiled nodes [18].
- iTowns reverted its per-format point budget and new screen-space error
  on 2018-04-27 and relanded both three days later, with no stated reason
  [40].
- GRASS removed the 6-double bounding box stored per feature, which for a
  point took "2-3 times more than the point itself" [24].
- Cesium's `show * positionClip` hiding [11]; navara's non-instanced
  "instanced" meshes [3]; osmdroid's grid clusterer [59].

## Guidance for a renderer here

1. **The data is fixed: cluster, aggregate and thin at bake time.** The
   OpenLayers 2 strategy reclusters on the client per resolution [30];
   markercluster pays its per-zoom hierarchy at load [31]; Marble decides
   which peaks show in its tile creator, offline [27]. A purpose-built
   renderer can do what Marble did: store the result per zoom (or per
   prefix, as osgEarth does [51]) so the renderer only selects a range.
2. **Order points by importance, then any prefix is a valid thinning.**
   One buffer, one `count` per zoom; no runtime sort [51][26]. If the
   importance is a hash, salt it independently of anything that made the
   positions, and test the spatial distribution, not only counts [51].
3. **No collision pass for dots.** Use instanced quads or `POINTS` with a
   fragment-shader circle; add a smoothstep edge if anti-aliasing matters
   [16][33]. Keep a collision pass only for labels [14][20].
4. **Budget fragments.** Keep dots small when they are dense and treat
   device pixel ratio as a budgeted parameter on phones [13]; measure the
   all-in-view frame separately from the camera path (pitfalls.md).
5. **GPU aggregation only above about 100K points per recount, and only
   when cell membership is not needed** [12]; otherwise aggregate on the CPU
   or at bake time, with compensated sums if the result is float32 [25].
6. **Hide by discard or by not drawing, never by collapsing vertices**,
   and let picking read the same visibility as the colour pass [11][50].
   iTowns lets each layer supply its own picking because raycasting
   millions of points does not work well [38]; for dense points use the
   id render in patterns.md.
7. **Screen-sized markers on world-space geometry**: Polymaps undoes the
   zoom scale per marker after each tile update [35]; in a shader, give
   the size in device pixels and project only the centre.
8. **Moving points need a stable id in the data**, so tracks interpolate
   instead of spawning and despawning [44]; collapse attributes that never
   change to constants at bake time [48]. Explode MultiPoint into Point at
   bake time so the renderer has one primitive [49].
9. **Point clouds**: support the encoding your data actually uses first
   [4]; if the view must gain detail on zoom, read an indexed format (COPC,
   EPT) by range rather than one global sample [6][19]; express budgets at
   node granularity [23]. A vertex dictionary (MLT sorts it by Hilbert
   curve) pays only when vertices repeat; MLT dropped its Morton RLE
   variant as "not very sensible & not implemented" [2].
10. **Few points (up to about ten thousand)**: none of this is needed. A
   single `POINTS` draw and CPU brute-force hover were enough for 7,342
   cities in example 07 [63].

## Sources

Numbers are shared with references/engines.md.

1. ref-repos/maplibre__maplibre-gl-js/docs/guides/large-data.md
2. https://github.com/maplibre/maplibre-tile-spec/blob/main/docs/encodings.md ; ref-repos/maplibre__maplibre-tile-spec/docs/encodings.md ; https://github.com/maplibre/maplibre-tile-spec/blob/main/rust/mlt-core/CHANGELOG.md ; ref-repos/maplibre__maplibre-tile-spec/rust/mlt-core/CHANGELOG.md
3. https://github.com/maplibre/navara/pull/434
4. https://github.com/maplibre/navara/pull/302
5. ref-repos/opengeos__RustGIS/docs/user-guide/data.md#large-files ; ref-repos/opengeos__RustGIS/docs/user-guide/data-formats.md
6. https://github.com/opengeos/RustGIS/commit/d053cf3 ; https://github.com/opengeos/RustGIS/commit/5f498a3 ; ref-repos/opengeos__RustGIS/docs/user-guide/data-formats.md (LiDAR row)
7. https://github.com/opengeos/RustGIS/commit/f2ae8c0
8. https://github.com/reearth/reearth-visualizer/commit/94bc5964
9. https://github.com/CesiumGS/cesium/pull/4336
10. https://github.com/CesiumGS/cesium/commit/2a1abcdc8
11. https://github.com/CesiumGS/cesium/commit/fb385b962909ee12e30b4388caec8c918589655f ; https://github.com/CesiumGS/cesium/commit/b17154b1b2388be98d3bd3bc00cb53c91b15a063
12. https://github.com/visgl/deck.gl/blob/master/docs/api-reference/aggregation-layers/overview.md ; ref-repos/visgl__deck.gl/docs/api-reference/aggregation-layers/overview.md ; https://github.com/visgl/deck.gl/blob/master/docs/upgrade-guide.md (Upgrading to v9.1) ; ref-repos/visgl__deck.gl/docs/api-reference/aggregation-layers/grid-layer.md (`gpuAggregation`, `colorScaleType`) ; ref-repos/visgl__deck.gl/docs/whats-new.md (deck.gl v7.1)
13. https://github.com/visgl/deck.gl/blob/master/docs/developer-guide/performance.md ; ref-repos/visgl__deck.gl/docs/developer-guide/performance.md ; ref-repos/visgl__deck.gl/docs/whats-new.md
14. https://github.com/visgl/deck.gl/pull/7712
15. https://github.com/visgl/deck.gl/pull/8886
16. https://github.com/visgl/deck.gl/commit/f70a37d4
17. https://github.com/visgl/deck.gl/commit/799c9c86
18. https://github.com/qgis/QGIS/pull/47257
19. https://github.com/qgis/QGIS/pull/42406
20. https://github.com/qgis/QGIS/commit/5798a82c80
21. https://github.com/qgis/QGIS/commit/c0f0bd552d ; https://github.com/qgis/QGIS/commit/ef292e6ada
22. https://github.com/qgis/QGIS/commit/f68e3ae5fa ; https://github.com/qgis/QGIS/commit/47a6e36ee0
23. https://github.com/qgis/QGIS/commit/962c68a9d3 ; https://github.com/qgis/QGIS/commit/6019168a86 ; https://github.com/qgis/QGIS/commit/f9e2409866
24. ref-repos/OSGeo__grass/doc/vector/TODO ; https://trac.osgeo.org/grass/ticket/542
25. https://github.com/OSGeo/grass/commit/f75284087cd89e160dffdadce3c1c9c116bad593
26. ref-repos/KDE__marble/docs/projects/kml/kml-tasks ; https://invent.kde.org/education/marble/-/blob/master/docs/projects/kml/kml-tasks
27. https://github.com/KDE/marble/commit/c22ac0db3
28. https://github.com/openlayers/openlayers/pull/5462
29. https://github.com/openlayers/openlayers/commit/7fa2189fe ; https://github.com/openlayers/openlayers/commit/71270efa7 ; ref-repos/openlayers__openlayers/changelog/upgrade-notes.md
30. https://github.com/openlayers/ol2/blob/master/lib/OpenLayers/Strategy/Cluster.js
31. ref-repos/Leaflet__Leaflet/docs/_posts/2012-08-20-guest-post-markerclusterer-0-1-released.md ; https://github.com/leaflet/Leaflet.markercluster/pull/29
32. https://github.com/Leaflet/Leaflet/issues/2164
33. https://github.com/tangrams/tangram/pull/583 ; https://github.com/tangrams/tangram/pull/472
34. https://github.com/tangrams/tangram/commit/0a37f38b
35. https://github.com/simplegeo/polymaps/commit/b31f277 ; ref-repos/simplegeo__polymaps/src/GeoJson.js
36. https://github.com/d3/d3-geo/commit/c316714 ; ref-repos/d3__d3-geo/src/path/string.js
37. https://github.com/iTowns/itowns/commit/16cbbbf ; https://github.com/iTowns/itowns/commit/ed09804 ; https://github.com/iTowns/itowns/commit/564cb062
38. https://github.com/iTowns/itowns/pull/635
39. https://github.com/iTowns/itowns/pull/767
40. https://github.com/iTowns/itowns/commit/5fda3f5b ; https://github.com/iTowns/itowns/commit/f18548f4 ; https://github.com/iTowns/itowns/commit/7ad11ae1 ; https://github.com/iTowns/itowns/commit/c1fdbc58
41. https://github.com/iTowns/itowns/commit/e7dde107
42. https://github.com/iTowns/itowns/commit/619a611d ; https://github.com/iTowns/itowns/commit/1f7afe84
43. https://github.com/iTowns/itowns/commit/108ef7f6
44. https://github.com/TerriaJS/terriajs/issues/1275
45. https://github.com/TerriaJS/terriajs/commit/c57884fc0 ; https://github.com/TerriaJS/terriajs/commit/cbf20257c
46. https://github.com/TerriaJS/terriajs/commit/4fdf240d5
47. https://github.com/TerriaJS/terriajs/commit/f738961a5 ; https://github.com/TerriaJS/terriajs/commit/ed281d189
48. https://github.com/TerriaJS/terriajs/commit/579d9317766c916ba4d1e89df0c77032f57c6528 ; https://github.com/TerriaJS/terriajs/commit/edbd1a3648429e234d1aa5165825c4f417ae2120
49. https://github.com/TerriaJS/terriajs/commit/0a121eabc3fca080334642e7951a4241a2fabd00
50. https://github.com/melowntech/vts-browser-js/issues/180
51. ref-repos/pelicanmapping__osgearth/docs/design/procedural2-plan-history.md (density-thinning correction, September 26, 2026) ; https://github.com/pelicanmapping/osgearth/blob/master/docs/design/procedural2-plan-history.md ; ref-repos/pelicanmapping__osgearth/docs/design/procedural2-plan.md ; ref-repos/pelicanmapping__osgearth/docs/design/procedural2-pbr-art.md
52. https://github.com/pelicanmapping/osgearth/issues/2783
53. https://github.com/pelicanmapping/osgearth/commit/a7ac6d59df120396090bf56015b268adc45c7de8 ; https://github.com/pelicanmapping/osgearth/commit/f47c67f6304c833ca82b551b3810f40dd49783f0
54. https://github.com/pelicanmapping/osgearth/commit/292497b84afe7a4acd2687ed561222bb4d41da67 ; https://github.com/pelicanmapping/osgearth/commit/32d7934de79456a00c481277030ce7abf803997d ; https://github.com/pelicanmapping/osgearth/commit/c91077e88aeadd01e00deb5e2784d04e35e69b94
55. https://github.com/pelicanmapping/osgearth/commit/709d15b75
56. https://github.com/mapnik/mapnik/blob/master/CHANGELOG.md ; https://github.com/mapnik/mapnik/commit/387b8f85d
57. https://github.com/MapServer/MapServer/commit/1a08f7fc
58. ref-repos/tilemill-project__tilemill commit d612c073 ; ref-repos/tilemill-project__tilemill/templates/Autostyle._
59. https://github.com/osmdroid/osmdroid/commit/a8a19677 ; https://github.com/osmdroid/osmdroid/commit/21a3b002
60. https://github.com/galileo-map/galileo/issues/41
61. https://github.com/podusowski/walkers/commit/b568e77
62. https://github.com/SciTools/cartopy/pull/1636
63. examples/03-quake-timeline/quake.ts ; examples/04-osm-node-density/spec.yaml (`performance_knowledge`) ; examples/07-world-cities-hover/cities.ts ; examples/07-world-cities-hover/spec.yaml (`brute-force-hover`)
