---
name: terrain-and-elevation
description: What 26 map engines learnt, with numbers, about storing, decoding, shading, meshing, culling, draping onto and picking against elevation data, including what they reverted. Load it when a map-from-scratch request involves a DEM (hillshade, colour relief, contours, a tilted 3D terrain view, lines, fills or labels on terrain, height under the cursor, an elevation profile or viewshed), or before choosing an elevation encoding in bake.ts.
---

# Terrain and elevation: bake the surface, keep the heights on the CPU

Elevation touches every stage of a renderer. The encoding decides precision
and whether the browser can decode it without corruption. Tile edges decide
whether shading and meshes have seams. A 3D surface brings meshes, cracks
between levels of detail, culling that has to know heights, overlays that
must follow the ground, and a camera that must not go underground. General
engines solve all of these at run time for any DEM and any camera. A
renderer made for one request usually knows its DEM, its zoom range and
its pitch at bake time, and can delete most of that machinery. This skill
says which decisions the engines made, what they cost, and which of them a
narrow request can skip. Per-engine detail is in
[references/engines.md](references/engines.md); the numbers in both files
refer to the Sources list at the end of this file.

## 1. Decide first: shaded 2D, or a 3D surface?

- 3D terrain cost grows with pitch. On an iPhone 16 Pro Max at z12,
  MapLibre Native was nearly free at pitch 25 (54.8 vs 61.2 fps), but at
  pitch 45 it ran 40.9 vs 60.5 fps and at pitch 65 21.5 vs 53.8 fps, with
  draw calls 28 vs 19 and CPU encode time x2.3 [18].
- MapLibre GL JS shipped terrain as one large PR whose first priority was
  that the 3D code not affect the 2D path [17].
- Some engine techniques serve the tilted view: Cesium's fog also culls
  distant tiles, and that culling uses the true fog density function even
  when a scalar changes how dense the fog looks [33].
- If the request is a flat map with relief, the whole mesh, crack, culling,
  draping and camera part of this skill does not apply. What remains is
  encoding (section 2), edges (3) and shading (4).

## 2. Encoding and decoding heights

- Image-encoded DEMs break in privacy-hardened browsers. Safari private
  browsing and Brave add noise to canvas `getImageData`; MapLibre detects
  the distortion and falls back to reading a WebCodecs `VideoFrame`, at
  0.5-1 ms per 512 px tile on desktop and 5-10 ms on an iPhone 14 [7]. The
  "spikes in Brave" seen while reviewing terrain were this [7][17].
- Check decoded heights after any step that writes the encoded channels.
  A Mapnik RasterColorizer output decoded a pixel as 188 m where it should
  have been about 239-240 m; the reporter worked around it with exact
  stops, and the issue is still open [105].
- Know which encoding a source uses: the Mapterhorn planet PMTiles here is
  Terrarium, and decoding it as Mapbox Terrain-RGB gives nonsense [114].
  MapLibre Native's hillshade is compatible with both encodings [20].
  forge3d decodes Terrarium tiles into f32 elevation buffers and reads
  Cloud Optimized GeoTIFFs (COG) by byte range directly in wgpu [116].
- A non-image format avoids both problems. ortho-earth's altpbf stores
  delta-coded SVarint grids under deflate-raw (native
  `DecompressionStream`) and decodes straight into an `Int16Array`: a
  5.7 M-point tile in ~21 ms and +12 MB instead of ~99 ms and +230 MB, and
  the planet in eight tiles totalling 55 MB [53][55]. Its wasm SIMD varint
  reader cut the varint part from 22 to 5 ms but the whole decode only from
  73 to 68 ms, because inflate dominated [55].
- 16 bits per tile are usually enough: osgEarth uploads heights as R16
  normalised to each tile's own min/max (half the memory of float), after
  first trying an RG8 high/low-byte packing [102]. An 8-bit grey DEM has
  only 256 levels between min and max [76].
- The MLT v2 draft stores z as int32 with elevation = -10000 m + z * 10^z_step:
  z = 0 is the Terrain-RGB base, and decimal steps make 12.34 m exact at a
  1 cm step [21].
- Reserve a nodata value that cannot be a height. maptalks uses
  `Float32Array([-1e12])[0]` instead of 0 [67].
- Decode off the main thread if decoding at run time at all: MapLibre
  transfers an `ImageBitmap` to a worker [13], openglobus moved RGB and
  Terrarium decoding into a worker [71]. Feature detection there brought a
  Safari regression [13].
- GPU sampling of DEM textures: float textures need
  `OES_texture_float_linear` for linear filtering, or fall back to nearest
  [79]; use `highp` for DEM texture coordinates, since mediump banded on
  mobile when overzoomed [15]; vertex texture fetch is not guaranteed
  (Mali-400 reports 0 vertex texture units), so for broad mobile targets
  bake heights into vertices [66].
- When a per-tile CPU transform is memory-bound, polishing the loop does
  not help: ortho-earth's JS resample stayed at ~12-15 ms for 3600^2 Int16
  cells, so it uploaded raw tiles and resampled on the GPU (per-cell CPU
  5.04 -> 0.58 ms, landing hitches 4 -> 0). Sample positions had to be exact
  integer fractions, because f32 positions drifted 1e-4 texel over 3600
  texels and gave cm-level errors on steep slopes [50].

## 3. Tile edges: share samples, carry a border

- Adjacent tiles must compute the same height at the shared edge. osgEarth
  elevation tiles are N+1 = 257 posts, sharing the edge row [97]; openglobus
  defines its vertex grid on pixel corners so neighbours share edge heights
  [71]. Nearest-neighbour resampling leaves gaps between tiles; osgEarth
  sped up bilinear instead [92].
- Slope needs neighbour pixels. MapLibre gives each DEM tile a 1 px border
  backfilled from its neighbours [1]. A MapLibre Native PR showed that 1 px
  is not enough once the shading texture is bilinearly filtered (seam
  luminance 1.65x / 1.98x the control) and widened it to 3 px for ~2% more
  memory; it was closed unmerged [19]. reearth-papers binds the full 3x3
  neighbourhood: with the centre tile alone the outer 16 columns differed
  by 8.4 on average and 121 at worst [30].
- Size texture pools by the real allocated stride including the border;
  keying MapLibre's pool by nominal tile size leaked GPU memory [12].

## 4. Shading and contours

- Compute shading once per tile, not per fragment per frame. navara went
  from vertex normals (seams at tile edges) to per-fragment Sobel (9 DEM
  samples per fragment per frame) to a normal map baked once per tile from
  a 258x258 backfilled DEM [24]. A faint seam left at about z14 also
  appears between two plain raster tiles, so it is tile-edge sampling, not
  the hillshade [24].
- Port a known formula rather than re-deriving it: QGIS adopted GDAL DEM's
  hillshade formulation (+20% single, +70% multidirectional) [61]; MapLibre
  Native ported the GL JS hillshade methods and color-relief [20].
- At run time, load only the DEM the visible tiles need: mapsforge moved
  neighbour overlap from load time to draw time, and one 1-arc-second HGT
  shaded in 900 ms instead of 3200 ms, a full map in 3.9 s instead of 40 s
  [113].
- Overzoom shading by sampling a sub-rectangle of the deepest ancestor
  instead of dropping the layer [25].
- Upload DEM-derived textures once per tile: re-uploading colour relief
  every frame cost "hundreds of MB/s for nothing" while panning [14].
- Contours: Organic Maps picks the interval per region by output size
  (20 m to 1000 m) and drops regions too large even at 100 m; its README
  calls the 500 m profile "completely useless" [112]. MapServer's
  documented setup changes the interval by scale [107].

## 5. The 3D mesh

- Use one regular grid per tile and share everything that depends only on
  grid size. WorldWind Java shares indices and texture coordinates per
  density (default 20) and counts only positions per tile [89]; iTowns
  shares one geometry per shape, which divided tile build time and memory
  by about 3 [77], and puts skirt indices last so hiding skirts is a draw
  range [73]; WebWorldWind packs every index variant into one buffer [87].
- Move the grid with a uniform, not by rebuilding it. ortho-earth's unit
  grid plus window uniform avoided reallocating 75 MB per window move
  (cumulative GL allocation 938 -> 652 MB over 20 hops) [51][56].
- Quantise vertices: Cesium cut terrain CPU memory by up to 40% [32].
  Store float offsets from a tile centre, not absolute Earth-scale floats
  [89].
- Size the grid for 16-bit indices: a 256x256 heightmap is 65,536 vertices
  and leaves no room for skirts; Cesium dropped skirts or resampled to 129
  [40].
- When the mesh is coarser than the DEM, keep extrema: openglobus moves
  peaks and pits to the nearest mesh vertex so summits survive [70]. Drop
  degenerate triangles, which are up to 50% of some quantized-mesh tiles
  [62].
- Cull chunks before adding LOD levels. ortho-earth measured the ceiling
  first (a grid with 1/4 of the triangles: 5.22 ms), then culled 16x16
  chunks against horizon, camera and one frustum plane: Fuji at z13 and
  60 degrees went from 7.18 to 3.55 ms with a pixel-identical image, and
  CDLOD-style per-chunk LOD was recommended against [50].

## 6. Cracks between tiles of different detail

| Method | Who | Cost |
| --- | --- | --- |
| Skirts (vertical strips under each edge) | Cesium, deck.gl, iTowns, osgEarth, WorldWind Java, QGIS, navara [39][49][74][93][89][62][29] | extra triangles and fill rate; show through translucent terrain |
| Border strips matched to the neighbour's level | WebWorldWind [87] | must know each neighbour's level |
| Edge equalisation with neighbours | openglobus [72] | per-edge bookkeeping, stitching bugs |

- Cesium removed screen-space crack filling as "not adequate" [39].
- Size skirts from the error you allowed: deck.gl uses 2x `meshMaxError`
  [49]. iTowns went from 5000 m to ever shorter heuristics because tall
  skirts cost fragment time, and wrote that the exact edge delta was "too
  heavy to compute" at run time [74]; at bake time it is cheap.
- WorldWind Java drops skirts to the global minimum elevation, which failed
  when a local model reported a positive minimum [89]. Use per-tile minima.
- iTowns added `hideSkirt` for layers with opacity < 1 [73].

## 7. Choosing and culling tiles

- A tile that cannot have children is drawn at any error; otherwise QGIS
  left holes when zoomed close [60].
- Bound upsampling: navara lets a tile borrow an ancestor's DEM at most 2
  levels up, because a far ancestor clipped gives a flat patch floating
  above or sunk below the real surface [23].
- Cesium's "fill" tiles, built from neighbours' edges, let it skip levels
  [34].
- Store each tile's min/max height. Cesium added server min/max BVH data,
  found it provided no benefit and removed it [34]; iTowns approximated min/max by reading every 32nd sample [75];
  osgEarth compiled a world min/max table to LOD 6 into the binary [96].
- Cull with the content's height, not the ground: MapLibre pads tile
  bounds, horizon plane and far plane by the largest symbol height offset
  [9]. Geometry displaced in a shader has unknown bounds, so osgEarth
  disables culling for it [90].
- For horizon culling of huge
  low-zoom tiles, pick the occludee point from the tile's geometry, not its
  bounding sphere, or level-0 tiles vanish near the poles [41].
- Five cached probe points per tile (four corners and the centre, with
  elevation) are WebWorldWind's distance estimate for LOD [84].

## 8. Putting 2D content on the surface

- Fills: render into a texture per terrain tile or ground window and sample
  it in the terrain shader. ortho-earth moved to this after vertex-draped
  fills sank under ridges on iPhone, and kept 2D direct-drawn [52]; navara
  does the same for MVT and GeoJSON, with a stencil pass so overlapping tile
  buffers are blended once [22][26].
- Such a cache must survive frames: MapLibre's 30-slot pool had a 0.2% hit
  rate; per-tile slots gave 94.6% and ~37 ms instead of ~410 ms, for 302 MB
  instead of 151 MB; a maintainer later reported OOM and FPS drops on a
  phone with v6 terrain and suspected this cache [5][6].
- Bake overlays into the terrain's tile grid; an untiled image in MapLibre
  vanished where it crossed tile borders [10].
- Lines on a coarse mesh must sample the mesh, with the same triangulation,
  not the DEM: ortho-earth's lines floated over convex slopes until they
  used the rendered triangles, subdivided to ~100 m under a 600k-vertex
  budget [57]; osgEarth matched its height query to its mesh diagonal rule
  [94].
- For thousands of draped lines over streamed terrain, Cesium tests
  per-tile segment lookup textures in the fragment shader (125K polylines
  at stable FPS) [38].
- Cesium's ground polygons are volumes extruded above and below the
  terrain and resolved with the stencil buffer, at the cost of many
  artifacts during development [36].
- If imagery and terrain grids do not nest (Geographic terrain, Web
  Mercator imagery), several raster tiles must be rendered into one texture
  per terrain tile [27]. Mercator-tiled rasters or DEMs on a globe need
  their rows remapped from Mercator Y to latitude [48].
- Draping flattens: osgEarth's projected-texture drape cannot carry 3D
  models, which it says should be baked into the renderer's projection
  instead [91].
- A depth offset of 0.5 for on-terrain vectors z-fought on Samsung devices
  and went back to 1.0 [111].

## 9. Heights for points and labels

- If the terrain is known at bake time, resolve heights there. VTS's
  run-time "float" heights returned different values until the finest
  terrain had loaded [83].
- Clamp once per label, never per glyph [43]; find a point's height through
  the tile that contains it, not a tree search per point [28].
- Use an enum for altitude meaning (none, clamp, relative), not a boolean
  [37].
- A per-frame time budget needs a bounded backlog: Cesium's 2 ms height
  update queue grew without limit until positions were cached [44].
- Never read a per-tile metric from a fake batch tile id: OsmAnd's sentinel
  tile gave tracks with per-point heights a negative elevation scale, under
  the surface [109].

## 10. Picking, profiles and analysis

- Raycast the DEM on the CPU instead of reading back the GPU. MapLibre
  removed a coordinate framebuffer and its readPixels: picks moved ~0.5 px
  (inside the old quantisation), globe picking went from ~12 px off to
  0.00 px, at 2 us (flat z2) to 63 us (sloped z16) per pick [3], and 4 MB
  less GPU memory [2]. Marker occlusion by the same ray walk replaced
  108-117 ms stalls with 45 markers on a Galaxy S24 [4].
- Point location on an irregular mesh goes through a spatial index built
  once (osgEarth put faces in an R-tree) [101]. Canvases read for heights
  need `{willReadFrequently: true}` [80].
- Report honest uncertainty: TerriaJS bounds the height error by the picked
  tile's min/max [81].
- Analysis that must be checkable (viewshed, sun shadow) ran on a CPU grid
  in a worker in ortho-earth and was drawn as an image [54].
- A profile should clip geometry to its corridor and keep gaps for nodata
  [64].

## 11. The camera

- Keep the camera above ground while a gesture holds centre elevation:
  in MapLibre, scrolling took the camera about 1 km under the surface and
  the zoom end threw it 3.9 km up; the fix lifts the camera during the hold,
  and the hold waits for the DEM [11].
- Heights that arrive mid-gesture move the camera: MapLibre freezes centre
  elevation during gestures and applies new DEM at release [8]. Cesium
  slides the camera up the surface instead of stopping it [45].
- Views looking up or from a drone need the camera modelled by position and
  orientation; MapLibre let the centre float above the ground for pitch
  beyond 90 degrees [16].
- If the request allows it, cap the pitch (section 1) [18].

## 12. Loading and caching

- Decide the elevation source before the first tile request: swapping
  terrain in later discarded every globe tile in TerriaJS, which now hides
  the globe until terrain is ready [82].
- Cap in-flight elevation requests per source (WebWorldWind: 16) [86],
  coalesce duplicate requests for one key (osgEarth's per-key gate, since
  normals need neighbours) [98], and make a cache hit move the entry rather
  than append it [104].
- Budget per-frame work during interaction (maptalks caps new terrain
  tiles per frame and altitude query time) [69], and keep must-complete
  queries out of throttled worker queues (Cesium) [46].
- Invalidate terrain only when its own source changes: QGIS rebuilt all
  terrain on any layer style edit [63].
- Several DEMs: WebWorldWind's elevation coverages query elevations per
  location in reverse order and handle NODATA [88].
- Size per-tile textures to need: maptalks shrank terrain masks to
  tileSize/4 [68]; osgEarth stores normals BC5-compressed and octahedral-
  encoded [103]; OsmAnd fixed its heightmap at 32 heixels per side [110].

## 13. Tried and reverted or abandoned

- MapLibre GL JS: GPU coordinate framebuffer and depth readback for
  picking, replaced by CPU raycast [3][4]; a 30-slot RTT pool [5].
  MapLibre Native: 3 px DEM border, unmerged
  [19].
- navara: vertex normals, then per-frame Sobel, then baked normals [24];
  stencil draping, then texture draping [26].
- Cesium: screen-space crack filling [39]; server BVH bounds [34]; an SDF
  clipping texture for a per-tile lookup [42]; a commit reducing redundant
  label clamping, reverted the same day it landed, before "Skip clamping
  for glyphs" landed that day [43]; last-layer-first terrain lookup, reverted [47].
- iTowns: five skirt height rules [74]; a gate that blocked subdivision
  until finer elevation arrived [78].
- osgEarth: RG8 height packing, then R16 [102]; a queue LRU that re-enqueued
  items [104]. OsmAnd: depth offset 0.5 [111]. GRASS: negative horizon
  angles [65].

## For a renderer in this repo

- Default to baking the relief. If the zoom range is fixed and the light
  does not move, bake hillshade or colour relief into the raster at bake
  time from a DEM with a border at least the kernel radius plus the filter
  footprint [19][30]; the renderer then draws an image (sections 2-4 move
  into `bake.ts`).
- Ship heights as integers you decode with no canvas: delta-coded int16 (or
  per-tile 16-bit relative to the tile's min) under gzip, like the 2D
  coordinate patterns in references/patterns.md of the main skill [53][102].
  If the source is Terrarium or Terrain-RGB WebP, decode it in `bake.ts`,
  where fingerprinting noise does not exist [7][114].
- Put min/max per tile in the header, and nodata as a sentinel outside the
  height range [75][67].
- For 3D, ask whether the pitch can be capped and say so in
  `architecture_selection` [18]. Then: one N+1 grid per tile with shared
  indices [97][89], skirts sized from the edge delta measured at bake time
  [74], chunk culling before any LOD scheme, measuring the coarse-grid
  ceiling first [50], one terrain level per view if the request allows it
  (no cracks to hide at all).
- Keep the heights on the CPU as well and answer picking, label heights and
  camera clearance from them; this repo's 1x1 id-buffer picking is for
  flat maps [3][115].
- Fills on terrain: one ground texture per tile; lines: geometry draped on
  the mesh's own triangles [52][57].
- Data: `yuiseki-open-data` lists the DEMs on this machine (Mapterhorn
  Terrarium PMTiles to z12, ETOPO 2022 15" COG) [114].
- Bench the steep view and the high pitch as fixed views, and add a
  functional check that reads the shading on both sides of a tile seam
  [19].

## Sources

Local paths are relative to the repository root.

1. ref-repos/maplibre__maplibre-gl-js/developer-guides/life-of-a-tile.md
2. ref-repos/maplibre__maplibre-gl-js/CHANGELOG.md (6.6.0, 6.10.0); https://github.com/maplibre/maplibre-gl-js/issues/7640
3. https://github.com/maplibre/maplibre-gl-js/pull/8158; https://github.com/maplibre/maplibre-gl-js/issues/1596; https://github.com/maplibre/maplibre-gl-js/commit/8c274a9cd; https://github.com/maplibre/maplibre-gl-js/commit/17ae8e33c
4. https://github.com/maplibre/maplibre-gl-js/pull/8387
5. https://github.com/maplibre/maplibre-gl-js/pull/7549; https://github.com/maplibre/maplibre-gl-js/commit/1454a123f
6. https://github.com/maplibre/maplibre-gl-js/pull/7635
7. https://github.com/maplibre/maplibre-gl-js/pull/3185
8. https://github.com/maplibre/maplibre-gl-js/pull/8471; https://github.com/maplibre/maplibre-gl-js/issues/8539
9. https://github.com/maplibre/maplibre-gl-js/pull/8319
10. https://github.com/maplibre/maplibre-gl-js/issues/1559
11. https://github.com/maplibre/maplibre-gl-js/pull/8547; https://github.com/maplibre/maplibre-gl-js/pull/8548
12. https://github.com/maplibre/maplibre-gl-js/commit/22ab43e08
13. https://github.com/maplibre/maplibre-gl-js/commit/85517f056; https://github.com/maplibre/maplibre-gl-js/commit/c0f06f26e; https://github.com/maplibre/maplibre-gl-js/commit/f8830012a
14. https://github.com/maplibre/maplibre-gl-js/commit/4b4f0d6f4; https://github.com/maplibre/maplibre-gl-js/commit/a6dd56577; https://github.com/maplibre/maplibre-gl-js/commit/23703cb2e
15. https://github.com/maplibre/maplibre-gl-js/commit/dda75ad45
16. https://github.com/maplibre/maplibre-gl-js/pull/4851
17. https://github.com/maplibre/maplibre-gl-js/pull/1022; https://github.com/maplibre/maplibre-gl-js/pull/165
18. https://github.com/maplibre/maplibre-native/pull/4190
19. https://github.com/maplibre/maplibre-native/pull/4280
20. https://github.com/maplibre/maplibre-native/pull/3965
21. https://github.com/maplibre/maplibre-tile-spec/blob/main/docs/specification/v2.md; ref-repos/maplibre__maplibre-tile-spec/docs/specification/v2.md
22. https://github.com/maplibre/navara/blob/main/guide/VECTOR_TILE_DRAPING.md; https://github.com/maplibre/navara/blob/main/guide/TILE_TEXTURE_COMPOSITING.md; ref-repos/maplibre__navara/guide/VECTOR_TILE_DRAPING.md
23. https://github.com/maplibre/navara/blob/main/guide/TILE_TERRAIN_TRAVERSAL.md; ref-repos/maplibre__navara/guide/TILE_TERRAIN_TRAVERSAL.md
24. https://github.com/maplibre/navara/pull/474; https://github.com/maplibre/navara/pull/573
25. https://github.com/maplibre/navara/pull/612
26. https://github.com/maplibre/navara/pull/485; https://github.com/maplibre/navara/pull/484; https://github.com/maplibre/navara/pull/559
27. https://github.com/maplibre/navara/pull/715
28. https://github.com/maplibre/navara/pull/498
29. https://github.com/maplibre/navara/commit/604d65bc; https://github.com/maplibre/navara/commit/ef839556; https://github.com/maplibre/navara/commit/541c5ad9; https://github.com/maplibre/navara/commit/19f08e85
30. https://github.com/reearth/reearth-papers/commit/9c87421; https://github.com/reearth/reearth-papers/commit/50a7e17; https://github.com/reearth/reearth-papers/commit/9f63562
31. https://github.com/reearth/reearth-visualizer/pull/2276
32. ref-repos/CesiumGS__cesium/CHANGES.md (1.17, 1.18); http://cesiumjs.org/2015/12/18/Terrain-Quantization/
33. https://github.com/CesiumGS/cesium/pull/3154; https://github.com/CesiumGS/cesium/pull/10186; https://github.com/CesiumGS/cesium/pull/12248
34. https://github.com/CesiumGS/cesium/pull/7061
35. https://github.com/CesiumGS/cesium/pull/2782
36. https://github.com/CesiumGS/cesium/pull/2865
37. https://github.com/CesiumGS/cesium/pull/2653
38. https://github.com/CesiumGS/cesium/pull/13577; https://github.com/CesiumGS/cesium/commit/0d0c35fad1cc05ed0560f0d1ec6a9197baaef84e; ref-repos/CesiumGS__cesium/packages/engine/Source/Core/VectorPipeline.js
39. https://github.com/CesiumGS/cesium/commit/b7d1b5a64; https://github.com/CesiumGS/cesium/commit/fa2200e3b; https://github.com/CesiumGS/cesium/commit/89bd3df10
40. https://github.com/CesiumGS/cesium/commit/0eafc5417; https://github.com/CesiumGS/cesium/commit/9fc98317e; https://github.com/CesiumGS/cesium/commit/610ad4f2f
41. https://github.com/CesiumGS/cesium/commit/e3b313606
42. https://github.com/CesiumGS/cesium/commit/1a74c94654ed16e99f6a13b7da1059f1c6b41520; https://github.com/CesiumGS/cesium/commit/dd17f1037609ce24d5c93cb63dbbae81b1219c6a; https://github.com/CesiumGS/cesium/commit/8862ae50335a5ef8bbcd25ead626a3281084caa9; https://github.com/CesiumGS/cesium/commit/e1c238f1c67562f31e879086e49ad5de3b87550f
43. https://github.com/CesiumGS/cesium/commit/83eb415e2ae339f1e09bc7de5f32f8dfbde4773a; https://github.com/CesiumGS/cesium/commit/3f678cae6b08093573f2c794d52d0892a73f3279; https://github.com/CesiumGS/cesium/commit/f99c570378220ba87be48ebb3049ec0e80ac8975
44. https://github.com/CesiumGS/cesium/commit/142b1d6c545bed0119493b12e4d969be100e7d2b; https://github.com/CesiumGS/cesium/commit/dd7bf0367ef5b170355c6dcbc4b5d6733bf65dc8; https://github.com/CesiumGS/cesium/commit/145e2f25982299d9e7ec3177112baa3c9d1168fc
45. https://github.com/CesiumGS/cesium/pull/1817
46. https://github.com/CesiumGS/cesium/commit/487b5f8f4; https://github.com/CesiumGS/cesium/commit/8efb2fed0
47. https://github.com/CesiumGS/cesium/commit/aa05e1fd0314ee4f06f0676d768d815a9dd1d421
48. https://github.com/visgl/deck.gl/pull/10350
49. https://github.com/visgl/deck.gl/commit/9ecb7b41
50. https://github.com/kenjiyoshidahome2026-bit/ortho-earth/blob/main/packages/ortho-core/perf%20plan.md; ref-repos/kenjiyoshidahome2026-bit__ortho-earth/packages/ortho-core/perf plan.md
51. https://github.com/kenjiyoshidahome2026-bit/ortho-earth/blob/main/packages/ortho-core/webgpu%20port.md; ref-repos/kenjiyoshidahome2026-bit__ortho-earth/packages/ortho-core/webgpu port.md; ref-repos/kenjiyoshidahome2026-bit__ortho-earth/packages/ortho-core/perf survey.md
52. https://github.com/kenjiyoshidahome2026-bit/ortho-earth/blob/main/packages/ortho-core/raster%20tiles.md; ref-repos/kenjiyoshidahome2026-bit__ortho-earth/packages/ortho-core/raster tiles.md
53. https://github.com/kenjiyoshidahome2026-bit/ortho-earth/blob/main/packages/altpbf/README.md; ref-repos/kenjiyoshidahome2026-bit__ortho-earth/packages/altpbf/README.md
54. https://github.com/kenjiyoshidahome2026-bit/ortho-earth/issues/44
55. https://github.com/kenjiyoshidahome2026-bit/ortho-earth/commit/c428c1a7; https://github.com/kenjiyoshidahome2026-bit/ortho-earth/commit/09245d64; https://github.com/kenjiyoshidahome2026-bit/ortho-earth/commit/952ad0e7
56. https://github.com/kenjiyoshidahome2026-bit/ortho-earth/commit/295c1e59; https://github.com/kenjiyoshidahome2026-bit/ortho-earth/commit/75371c28
57. https://github.com/kenjiyoshidahome2026-bit/ortho-earth/commit/a4ddf642; https://github.com/kenjiyoshidahome2026-bit/ortho-earth/commit/8952db4d; https://github.com/kenjiyoshidahome2026-bit/ortho-earth/commit/f8bb2182
58. https://github.com/qgis/QGIS/pull/5203; https://github.com/qgis/QGIS-Enhancement-Proposals/issues/105
59. https://github.com/qgis/QGIS/pull/63444
60. https://github.com/qgis/QGIS/commit/b85234f5fc
61. https://github.com/qgis/QGIS/commit/6353715f71
62. https://github.com/qgis/QGIS/commit/a0d9093889; https://github.com/qgis/QGIS/commit/be4ccb5c66
63. https://github.com/qgis/QGIS/pull/65715; ref-repos/qgis__QGIS/src/3d/qgsglobechunkedentity.cpp; ref-repos/qgis__QGIS/src/3d/qgsmapoverlayentity.cpp
64. https://github.com/qgis/QGIS/pull/54964
65. https://github.com/OSGeo/grass/commit/e6dcec0d8
66. https://github.com/tangrams/tangram/pull/282
67. https://github.com/maptalks/maptalks.js/commit/9c8439f4f
68. https://github.com/maptalks/maptalks.js/commit/1a621a88e; https://github.com/maptalks/maptalks.js/commit/9cf3c18c5
69. https://github.com/maptalks/maptalks.js/commit/efc302342; https://github.com/maptalks/maptalks.js/commit/24621aa4a
70. https://github.com/openglobus/openglobus/commit/fd645980; https://github.com/openglobus/openglobus/commit/6517a3b1; ref-repos/openglobus__openglobus/src/terrain/terrainUtils.ts
71. https://github.com/openglobus/openglobus/issues/1134; https://github.com/openglobus/openglobus/commit/f44fee6b
72. https://github.com/openglobus/openglobus/commit/becb0492; https://github.com/openglobus/openglobus/commit/6e60f8f7; https://github.com/openglobus/openglobus/commit/d64858b2
73. https://github.com/iTowns/itowns/commit/06c71816; https://github.com/iTowns/itowns/commit/f3d2e90b; ref-repos/iTowns__itowns/changelog.md
74. https://github.com/iTowns/itowns/commit/c36b3bed; https://github.com/iTowns/itowns/commit/6c38cb22; https://github.com/iTowns/itowns/commit/ba0f03fc
75. https://github.com/iTowns/itowns/commit/663634c4
76. https://github.com/iTowns/itowns/commit/23cc1422
77. https://github.com/iTowns/itowns/commit/9241818a
78. https://github.com/iTowns/itowns/commit/e3866370; https://github.com/iTowns/itowns/commit/c726f251
79. https://github.com/iTowns/itowns/commit/db4f5365
80. https://github.com/iTowns/itowns/commit/9ee991c3
81. https://github.com/TerriaJS/terriajs/commit/802ae4c8a; https://github.com/TerriaJS/terriajs/commit/6c7ed9665; https://github.com/TerriaJS/terriajs/commit/d5ff6b5cd
82. https://github.com/TerriaJS/terriajs/commit/2665cf264c5351b523df798169832da02d36b20e
83. https://github.com/melowntech/vts-browser-js/issues/121; https://github.com/melowntech/vts-browser-js/issues/179; ref-repos/melowntech__vts-browser-js/src/core/map/geodata-builder.js
84. https://github.com/NASAWorldWind/WebWorldWind/commit/d814cf5; ref-repos/NASAWorldWind__WebWorldWind/src/geom/Sector.js
85. https://github.com/NASAWorldWind/WebWorldWind/issues/586
86. https://github.com/NASAWorldWind/WebWorldWind/commit/ba88056
87. https://github.com/NASAWorldWind/WebWorldWind/commit/f2a633b; ref-repos/NASAWorldWind__WebWorldWind/src/globe/Tessellator.js
88. https://github.com/NASAWorldWind/WebWorldWind/issues/580; https://github.com/NASAWorldWind/WebWorldWind/issues/92
89. ref-repos/NASAWorldWind__WorldWindJava/src/gov/nasa/worldwind/terrain/RectangularTessellator.java; https://github.com/NASAWorldWind/WorldWindJava/blob/2543c23/src/gov/nasa/worldwind/terrain/RectangularTessellator.java; ref-repos/NASAWorldWind__WorldWindJava/src/gov/nasa/worldwind/formats/shapefile/ShapefilePolygons.java
90. https://github.com/pelicanmapping/osgearth/issues/2074
91. https://github.com/pelicanmapping/osgearth/issues/693
92. https://github.com/pelicanmapping/osgearth/issues/2770
93. https://github.com/pelicanmapping/osgearth/commit/46bbbf275cd970e3b24f9d1bfd56d0fa5bf81b55; https://github.com/pelicanmapping/osgearth/commit/c70d20b52876f18ea4bf3be8e0f2d30f7a5ccdec; https://github.com/pelicanmapping/osgearth/commit/e81668bb2db823c6cedd023e1c45e5c8efa6e003
94. https://github.com/pelicanmapping/osgearth/commit/a1663895ca8ac6650cdf8aed097951c536846950; https://github.com/pelicanmapping/osgearth/commit/b0fd185975425941205772e6996f01b35fd200ca
95. https://github.com/pelicanmapping/osgearth/commit/67cdfa38bc916884e47be73965a84bf4972c833c; https://github.com/pelicanmapping/osgearth/commit/aaf11b6b058217eca71239f50918342d5b89a634
96. https://github.com/pelicanmapping/osgearth/commit/e0c02fa6e
97. https://github.com/pelicanmapping/osgearth/commit/a4697bf79
98. https://github.com/pelicanmapping/osgearth/commit/48e2bd8dc; https://github.com/pelicanmapping/osgearth/commit/b73fa40b2
99. https://github.com/pelicanmapping/osgearth/commit/a86066510; https://github.com/pelicanmapping/osgearth/commit/a2542fe60
100. https://github.com/pelicanmapping/osgearth/commit/10c588a0b; https://github.com/gwaldron/osgearth/issues/1440
101. https://github.com/pelicanmapping/osgearth/commit/367a3cf66; https://github.com/pelicanmapping/osgearth/commit/0a7396f54
102. https://github.com/pelicanmapping/osgearth/commit/10051c15c; https://github.com/pelicanmapping/osgearth/commit/2cd451ee3; https://github.com/pelicanmapping/osgearth/commit/dbe770085; ref-repos/pelicanmapping__osgearth/src/osgEarth/Elevation.cpp
103. https://github.com/pelicanmapping/osgearth/commit/b3c38aadf; https://github.com/pelicanmapping/osgearth/commit/d7146d62f; https://github.com/pelicanmapping/osgearth/commit/67931b7d4; https://github.com/pelicanmapping/osgearth/commit/8f4bd117d
104. https://github.com/pelicanmapping/osgearth/commit/bf1cb2216; https://github.com/pelicanmapping/osgearth/commit/6d7e5e3b9
105. https://github.com/mapnik/mapnik/issues/3970
106. https://github.com/mapnik/mapnik/issues/2491
107. https://github.com/MapServer/MapServer/issues/6182
108. https://github.com/osmandapp/OsmAnd-core/pull/1126
109. https://github.com/osmandapp/OsmAnd-core/pull/1098
110. https://github.com/osmandapp/OsmAnd-core/commit/d7dafae4
111. https://github.com/osmandapp/OsmAnd-core/commit/1e2314a1
112. ref-repos/organicmaps__organicmaps/data/conf/isolines/README.md; ref-repos/organicmaps__organicmaps/data/conf/isolines/isolines-profiles.json; https://github.com/organicmaps/organicmaps/blob/master/data/conf/isolines/README.md
113. https://github.com/mapsforge/mapsforge/pull/1561; https://github.com/mapsforge/mapsforge/pull/1569
114. .agents/skills/yuiseki-open-data/references/catalog.md (Mapterhorn planet.pmtiles, ETOPO_2022_15s_bed.tif)
115. skills/map-from-scratch/references/patterns.md (Interaction: picking with a 1x1 id render)
116. ref-repos/milos-agathon__forge3d/src/gis/cog_range.rs, ref-repos/milos-agathon__forge3d/src/gis/terrarium.rs, https://github.com/milos-agathon/forge3d
