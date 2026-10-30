---
name: data-range-requests
description: How map engines read one big static file (PMTiles, GeoParquet, FlatGeobuf, COG, COPC, Zarr) by HTTP Range instead of downloading it, and how they lay such files out, cache, schedule and harden the reads. Load it when a map-from-scratch renderer will fetch data at run time by byte range, when designing a baked format meant to be range-read, when a Range read misbehaves (200 instead of 206, CORS preflight, 501 on a suffix range, offsets off after gzip, a stale archive), or when deciding whether to fetch a file whole instead.
---

# Reading data by HTTP Range

A renderer that reads one static file by byte range needs no tile server, and
a view costs only the bytes it shows. The price is latency. Every level of
index is a sequential round trip before the first payload byte, hosts answer
Range in ways that break naive readers, and a cache keyed by URL alone mixes
up every range of the same file. A file that is not laid out for the view
gives nothing back: pruning selects every block and the reader fetches the
whole file in pieces. The engines below converge on one shape: a fixed-size
or self-describing header, an index read lazily and cached within a bound,
exact payload ranges, coalesced and cancellable requests, and a whole-file
fallback that runs on purpose, not by accident. Per-engine detail is in
[references/engines.md](references/engines.md). Which of the owner's hosts
and files read well by Range is measured in the `yuiseki-open-data`
skill [75]; this skill does not repeat it.

## Decide first: range-read, or fetch whole?

- **Fetch whole below a size threshold.** ortho-earth converts a GeoParquet
  whole up to 8 MB and streams row groups only above it [41]; its own GeoPBF
  format has no index and no partial reads by design, because the viewer
  loads everything anyway [39].
- **Range reading does not help world views.** The whole-US view of a 14.1 MB
  FlatGeobuf fetched all 14.1 MB (1.5 s) through the R-tree; a DC view fetched
  0.74 MB [14]. RustGIS refuses an Overture view that needs more than six
  GeoParquet files (a country takes dozens) and offers the theme's world
  PMTiles as a separate option [25]; reearth-papers draws zooms below 8 from
  one baked overview COG, because a z<8 tile would touch up to ~900 per-3°
  COGs [30]. Pair a range-read file with a
  pre-generalised overview for low zooms.
- **Measure where the time goes.** ortho-earth added three COPC decode
  workers and reverted them: decode took 1.4 s for 43 nodes, settling varied
  2.4-4.0 s with the network, so more workers only cost memory [45].
- **A sample is not the data.** RustGIS caps features per view (250,000 local,
  60,000 remote on the desktop; 100,000 and 30,000 in the browser) and draws
  an evenly spread sample [16][17]. Later it found the sample dropped valid
  features from exports and added a complete chunked traversal [24]. Sample
  for an interactive overview, never for anything that claims completeness.

## The read path

1. **First request: header plus root index in one round trip.** navara reads
   16 KiB, which holds the PMTiles header and root directory, and asks again
   only if the root directory lies beyond it [10]. maplibre-native reads the
   127-byte header alone, then the root directory, up to three leaf levels
   (a deeper one is an error), then the tile, so a cold tile costs 3 to 6
   sequential requests [1].
   GeoServer reads a COG header in 16 KB chunks, adding chunks while the
   header does not fit [57]. Size the first read to the header and index of
   the files you bake.
2. **Grow index reads geometrically.** RustGIS read COG headers in fixed
   256 KB steps; 12 rounds stopped at about 3 MB, so a 4 MB index (346,092
   tiles) was refused. Doubling the step each round fixed it [23].
3. **Footers (Parquet): explicit ranges in the browser.** The Fetch standard
   safelists only a single `bytes=a-b` or `bytes=a-` range; a suffix
   `bytes=-n` is not safelisted [72]. ortho-earth measured that a suffix range
   sent a preflight that its host did not answer ("Failed to fetch"), so it
   reads `bytes=0-0` for the length from `Content-Range`, then the last
   64 KB by explicit offsets [41][40]. RustGIS uses suffix ranges natively,
   but GitHub release assets (Azure storage) answered `bytes=-n` with 501, so
   it probes the length with a one-byte range, follows redirects, and reads
   the probe body so the connection is reused [18].
4. **Prune before fetching payload.** RustGIS and ortho-earth select row
   groups whose bbox covering statistics meet the view, then fetch only the
   geometry and needed attribute column chunks [14][40]. ortho-earth fetches
   attributes for a row group only on the first hover or click [41]. RustGIS
   walks a FlatGeobuf's packed R-tree one level per round [14]. maplibre-native
   returns no content without any request for zooms outside the header's
   range [1]; GeoServer drops a cascaded layer whose advertised bounds miss
   the request [58]; RustGIS stopped reading streamed layers outside their
   zoom range after a FlatGeobuf fetched tens of MB never drawn [22]. Gate
   every read with the same visibility test as drawing.
5. **Coalesce, round, budget.** RustGIS fetches planned ranges exactly, rounds
   unplanned misses to 64 KiB, merges gaps under 16 KiB, splits pieces at
   16 MiB, and caps a read at 96 MiB (wasm) or 256 MiB (native) and 48 rounds
   [15]. ortho-earth merged 64 column-chunk ranges into 33 requests and read
   110 KB of a 505 KB file for a Tokyo view [40]. In GRASS, larger I/O
   segments made a module 25-33% faster by cutting kernel time [65].

## Status codes, encodings and hosts

- **Require 206.** A 200 is the whole file. ortho-earth's Cloudflare Workers
  Assets host ignored Range and returned 200 in production; it now probes
  with one byte and, on 200, uses the body as an in-memory source [42].
  RustGIS treats a tail request answered with a longer whole file as "no
  Range support", reading at most n+1 bytes natively, and falls back to a
  whole download [19][14]. Never parse a 200 body as the slice you asked for.
- **Accept 206 everywhere you ship.** maplibre-native's Android HTTP layer
  treated 206 as an error ("Error fetching PMTiles header: HTTP status code
  206"); CI stayed green because network tests did not run on Android [2].
- **Transfer encoding must not touch the bytes.** RustGIS sends
  `Accept-Encoding: identity` on range requests after flatgeobuf.org gzipped
  ranges [14]. A browser page cannot set `Accept-Encoding` [72]; check
  `Content-Range` and `Content-Encoding` on the response instead.
- **Probe existence with a one-byte GET, not HEAD.** HEAD got 403 from a WAF
  without a User-Agent and from an S3 presigned URL signed for GET [43].
- **Avoid custom headers on cross-origin range requests.** Each one costs a
  preflight per URL; Cesium moved its token from `Accept` back to
  `Authorization` once the spec closed the trick [33]. Prefer
  unauthenticated, cacheable URLs.
- **Browser cache bugs exist.** protomaps-leaflet users saw random
  `ERR_CACHE_OPERATION_NOT_SUPPORTED` on Windows Chrome for range requests;
  `cache: 'no-store'` fixed it at the price of browser caching [48].

## Caching and deduplication

- **Key on URL plus range.** maplibre-native appends `_mlnRange=start-end` to
  the cache key, because every PMTiles request has the same URL and its cache
  table is unique by URL [3]. navara deduplicates in flight by URL plus byte
  range [13]. Keep ranges deterministic (whole index blocks, whole row groups)
  so keys repeat; a differently aligned request misses [3].
- **Bound the index cache.** maplibre-native: 100 directories per archive,
  FIFO with move-to-back [1]. navara: leaf directories up to 32 MB, because
  caching every leaf of a global archive costs 50-500 MB [10]. RustGIS evicts
  one entry when full instead of clearing the cache, and makes tiles waiting
  for the same leaf share one fetch [19].
- **One reader per file per page.** Two scripts each opening the same PMTiles
  duplicated header and directory requests; protomaps-leaflet now accepts a
  shared instance [47].
- **Detect replacement.** Caching the header desynchronised when a CDN file
  was replaced mid-session; maplibre-native tracks ETag and invalidates on
  change [3][4]. reearth-papers puts the snapshot date into its cache key and
  resolves the current version from a pointer file with a 1 h TTL [29].
  Simplest for a baked file: a new file name per version.
- **Cache wire bytes** when decoding is cheap; osgearth switched from caching
  decoded objects to raw payloads [67]. Mapnik reverted its own file cache
  because the OS page cache already did the work [63].

## Scheduling

- **Cap concurrency and cancel stale requests.** deck.gl defaults to 6 in
  flight (Chrome's HTTP/1.1 per-host limit), aborts requests for tiles no
  longer selected via `AbortSignal`, and re-checks selection when a queued
  request is dispatched, not when it is queued [35][36][37]. For HTTP/2 the
  PR author first removed the limit from the OSM example ("much much
  faster"), then, after the objection that zooming fast should not request
  every passing tile, set it to 20, which "still seems very fast" [35].
  Cesium keeps a cap but raises it from 6 to 18 for known HTTP/2 hosts,
  rejecting unlimited because requests made during a camera flight are
  wasted [32].
- **Throttling helps slow links and mixed sources, not much else.** Cesium's
  global scheduler: zoom from space on 4G 6.41 s/216 requests to 5.93 s/190;
  on HTTP/2 throttled 5.1-5.8 s against 4.9-5.3 s unthrottled [31].
- **Index fetches first, nearest first.** navara lets directory fetches bypass
  tile backpressure and orders them by screen-space error, then distance, so
  the view centre resolves first under HTTP/1.1 limits [11]. A custom tile
  priority scheme was committed and reverted in favour of plain distance
  ordering [13].
- **Debounce only when requests are expensive.** deck.gl's `debounceTime`
  defaults to 0; it saves bandwidth during pans at the cost of latency [38].

## Laying out a file to be range-read (bake time)

- **Sort spatially and keep per-block bboxes.** 1M points in 50 row groups:
  row-group bbox overlap 24.5 unsorted, 0.87 Morton, 0.28 Hilbert, 0.00 STR;
  candidate groups for a city query 50 / 3-4 / 2 / 1-2. A bbox column doubled
  a point file (45.6 MB vs 21.4 MB) [39]. RustGIS writes Hilbert-sorted
  GeoParquet with 65,536-row groups and a bbox covering [16][17]. Without a
  covering, both readers fall back to reading everything [14][40].
- **Make an index node a byte range.** MapServer's `coshp` rewrites a
  shapefile so record order matches the depth-first quadtree, turning a box
  query into a few contiguous ranges [53]. mapsforge computes a tile's 5-byte
  index entry from its coordinates, so no keys are stored [59].
- **Compress chunks independently**, storing a chunk raw when compression
  does not shrink it (GRASS raster rows) [64].
- **Align the render tile with the storage chunk** so adjacent tiles do not
  refetch one chunk (OpenLayers GeoZarr) [50]; do not let one-row TIFF strips
  become one-row tiles [51].
- **Choose codecs the reader has.** zstd is the default of GDAL, DuckDB,
  pyarrow and gpio [21]; browsers have no zstd in `DecompressionStream`, which
  is why this repo ships `kits/geoparquet/zstd.ts` [76]. ortho-earth test-reads
  one column at open and refuses with a reason if it cannot decode it [44].

## Robustness

- **Trust bytes over headers.** maplibre-native decompresses a PMTiles tile
  only if it starts with gzip magic, whatever the header says, and turns
  corrupt data into a per-request error; an exception on its PMTiles thread
  had called `std::terminate` [5][6].
- **Validate every offset before allocating.** MapServer's FlatGeobuf reader
  computed feature offsets from the wrong base (going negative), dropped the
  last index hit, and overflowed on a crafted ring count [55][56]; Mapnik hung
  at 4.5 GB on a bogus record length [62]. RustGIS uses saturating arithmetic
  near `u64::MAX` and fails a round asking for more than twice its budget
  [14][15].
- **Version the index format.** Mapnik's part-level shapefile index broke
  the old `.index` format; stale files are skipped until regenerated rather
  than misread [78].
- **Remember what is missing.** WorldWind Java marks a tile absent for a
  retry interval, then a longer one after N failures, instead of requesting
  it every frame [66]; a baked manifest of existing tiles makes this
  unnecessary.
- **Test with files from several writers and on every network stack.** The
  single MapServer test file exercised none of the failing paths [55].

## Tried and reverted

- maplibre-native's first PMTiles reader re-fetched the header with every
  tile, which avoided stale headers but was "extremely wasteful"; the header
  is now cached and checked by ETag [3].
- navara: a prioritised fetch order, reverted to distance ordering [13].
- ortho-earth: three COPC reader workers, reverted (network-bound) [45].
- RustGIS: fixed 256 KB COG header steps, replaced by doubling [23].
- Mapnik: an application-level file cache, reverted [63].
- Cesium: a token in `Accept` to avoid preflights, reverted to
  `Authorization` when the spec forced a preflight for long `Accept`
  values [33].
- deck.gl: a separate `throttleRequests` switch, removed; throttling is on
  whenever `maxRequests > 0` [36].
- maplibre-native: `#ifdef`s for optional PMTiles, replaced by a stub file
  source whose `canRequest()` is always false; PMTiles cost +1.65 MiB on
  Linux and +210 KiB on iOS [2].

## In this repository

- `bin/mfs serve` and the bench server answer a single range with 206 or 416,
  suffix ranges included, same-origin, `cache-control: no-store`, with
  COOP/COEP [73]. It therefore cannot show a preflight, a 200 for a Range, a
  501 on a suffix, or a CDN cache. Before relying on a remote host, probe it
  (see `yuiseki-open-data` [75]) and handle the cases above in the reader.
  Under COEP `require-corp`, remote data must be fetched with CORS [73].
- Emit `range_requests` and `range_bytes` per scenario from the renderer's
  fetch wrapper, and set `benchmarks.network` (e.g. 4G 60 ms, 9 Mbps) so
  round trips show up in the first frame [74].
- Keep the format reader a pure function of bytes that returns the ranges it
  needs (navara, RustGIS) [10][15]; then a bake-time Node test can drive it
  from a local file and the browser from `fetch`. maplibre-native gave its
  APK asset source the same range semantics as HTTP, and QGIS reads remote
  EPT through the local provider with only the index access swapped [7][68].
  Keep the container reader separate from the payload decoder [12].
- If you serve the file yourself (a Worker, R2, a bucket), single-range GET
  with suffix and open-ended ranges, 416 with the size, and a global OPTIONS
  answer were enough for GDAL `/vsicurl/` and PMTiles clients in
  reearth-papers [27].
- WebAssembly JSPI for synchronous C/Rust readers: Existing C/Rust spatial parsers
  (GDAL, libpmtiles, libgeotiff) use synchronous I/O. In the browser, compiling with
  `-sJSPI` allows C to call an asynchronous JS `fetch(url, { headers: { Range: ... } })`
  using `EM_ASYNC_JS` as a normal synchronous function, suspending the Wasm call stack
  via `WebAssembly.Suspending` without the 2-5x code bloat of ASYNCIFY (`wasm-001-jspi-range-reader`).
  Exported Wasm functions calling async imports must be listed in `-sJSPI_EXPORTS=fn1,fn2`
  to be automatically wrapped with `WebAssembly.promising()`.
- What to write in `performance_knowledge`: bytes and requests for the first
  view and a pan, round trips before the first frame under the emulated
  network, and the same numbers for fetching the file whole.

## Sources

1. ref-repos/maplibre__maplibre-native/platform/default/src/mln/storage/pmtiles_file_source.cpp; https://github.com/maplibre/maplibre-native/commit/cf9f41cf6; ref-repos/maplibre__maplibre-native/platform/android/docs/data/PMTiles.md
2. https://github.com/maplibre/maplibre-native/pull/2882
3. https://github.com/maplibre/maplibre-native/pull/4290; https://github.com/maplibre/maplibre-native/commit/a2eb4409a; ref-repos/maplibre__maplibre-native/platform/default/src/mln/storage/offline_database.cpp; ref-repos/maplibre__maplibre-native/test/storage/offline_database.test.cpp; ref-repos/maplibre__maplibre-native/test/storage/pmtiles_file_source.test.cpp
4. https://github.com/maplibre/maplibre-native/pull/4111
5. https://github.com/maplibre/maplibre-native/commit/9a4fd44c3; ref-repos/maplibre__maplibre-native/test/fixtures/storage/pmtiles/uncompressed-tiles.py
6. https://github.com/maplibre/maplibre-native/pull/4399
7. https://github.com/maplibre/maplibre-native/pull/4602; https://github.com/maplibre/maplibre-native/commit/c75849437; https://github.com/maplibre/maplibre-native/pull/3404; ref-repos/maplibre__maplibre-native/platform/android/MapLibreAndroid/src/cpp/asset_manager_file_source.cpp
8. ref-repos/maplibre__maplibre-native/design-proposals/2025-07-05-custom-vector-source.md; https://github.com/maplibre/maplibre-native/commit/9ef0f1c79
9. ref-repos/maplibre__maplibre-native/platform/ios/CHANGELOG.md; ref-repos/maplibre__maplibre-native/platform/android/CHANGELOG.md
10. ref-repos/maplibre__navara/crates/pmtiles/src/archive.rs; https://github.com/maplibre/navara/blob/main/crates/pmtiles/src/archive.rs; https://github.com/maplibre/navara/blob/main/docs/src/content/docs/three/Source/vector-tile-source.md
11. ref-repos/maplibre__navara/crates/navara_pmtiles/src/source.rs
12. https://github.com/maplibre/navara/pull/637
13. https://github.com/maplibre/navara/commit/20d30a41
14. https://github.com/opengeos/RustGIS/pull/152; https://github.com/opengeos/RustGIS/commit/564f953; https://github.com/opengeos/RustGIS/pull/158
15. ref-repos/opengeos__RustGIS/crates/data/src/source/remote.rs
16. ref-repos/opengeos__RustGIS/docs/user-guide/data-formats.md
17. ref-repos/opengeos__RustGIS/docs/user-guide/data.md
18. https://github.com/opengeos/RustGIS/commit/ca0e79c
19. https://github.com/opengeos/RustGIS/commit/f9a9343
20. https://github.com/opengeos/RustGIS/commit/4d0d1ff
21. https://github.com/opengeos/RustGIS/commit/32011de
22. https://github.com/opengeos/RustGIS/commit/8083c40
23. https://github.com/opengeos/RustGIS/commit/d9d2a7b; https://github.com/opengeos/RustGIS/commit/3429749
24. https://github.com/opengeos/RustGIS/pull/70; https://github.com/opengeos/RustGIS/pull/71; https://github.com/opengeos/RustGIS/pull/681
25. ref-repos/opengeos__RustGIS/docs/user-guide/web-data.md
26. https://github.com/opengeos/RustGIS/commit/d97bd75; https://github.com/opengeos/RustGIS/commit/3f3c045
27. https://github.com/reearth/reearth-papers/commit/b7272b1; ref-repos/reearth__reearth-papers/README.md
28. https://github.com/reearth/reearth-papers/commit/4148135; https://github.com/reearth/reearth-papers/commit/2caf02d; ref-repos/reearth__reearth-papers/CONTRIBUTING.md
29. ref-repos/reearth__reearth-papers/src/pmtiles.ts; https://github.com/reearth/reearth-papers/commit/058c19a
30. https://github.com/reearth/reearth-papers/commit/6578932; https://github.com/reearth/reearth-papers/commit/0011827
31. https://github.com/CesiumGS/cesium/pull/3476
32. https://github.com/CesiumGS/cesium/pull/6445; https://github.com/CesiumGS/cesium/commit/26fc56183
33. https://github.com/CesiumGS/cesium/commit/c67111c60; https://github.com/CesiumGS/cesium/commit/d6b06e5c4; https://github.com/CesiumGS/cesium/pull/8561
34. https://github.com/CesiumGS/cesium/pull/7196; ref-repos/CesiumGS__cesium/CHANGES.md
35. https://github.com/visgl/deck.gl/pull/4838
36. https://github.com/visgl/deck.gl/commit/1ca25a6b; https://github.com/visgl/deck.gl/commit/b2fcd89b; https://github.com/visgl/deck.gl/commit/e7261715; https://github.com/visgl/deck.gl/commit/05ca54e0
37. https://github.com/visgl/deck.gl/commit/8046edd2; https://github.com/visgl/deck.gl/commit/0adfe055; https://github.com/visgl/deck.gl/commit/19af42d9
38. https://github.com/visgl/deck.gl/commit/401e7a6d
39. ref-repos/kenjiyoshidahome2026-bit__ortho-earth/packages/geopbf/README.md; https://github.com/kenjiyoshidahome2026-bit/ortho-earth/blob/main/packages/geopbf/README.md; ref-repos/kenjiyoshidahome2026-bit__ortho-earth/packages/geopbf/pbf spec.md
40. https://github.com/kenjiyoshidahome2026-bit/ortho-earth/commit/cc67c5c7
41. https://github.com/kenjiyoshidahome2026-bit/ortho-earth/commit/551a2aa5
42. https://github.com/kenjiyoshidahome2026-bit/ortho-earth/commit/dd86280f
43. https://github.com/kenjiyoshidahome2026-bit/ortho-earth/commit/c77fbd46
44. https://github.com/kenjiyoshidahome2026-bit/ortho-earth/commit/0dcc93bf; https://github.com/kenjiyoshidahome2026-bit/ortho-earth/commit/b316e2ad
45. https://github.com/kenjiyoshidahome2026-bit/ortho-earth/commit/93720c28; https://github.com/kenjiyoshidahome2026-bit/ortho-earth/commit/7ca1bba5
46. ref-repos/kenjiyoshidahome2026-bit__ortho-earth/DATA.md; https://github.com/kenjiyoshidahome2026-bit/ortho-earth/blob/main/packages/globe/src/columnar/README.md; https://github.com/kenjiyoshidahome2026-bit/ortho-earth/commit/82c17eb6; https://github.com/kenjiyoshidahome2026-bit/ortho-earth/commit/d923b87e
47. https://github.com/protomaps/protomaps-leaflet/issues/6; ref-repos/protomaps__protomaps-leaflet/CHANGELOG.md
48. https://github.com/protomaps/protomaps-leaflet/issues/104
49. ref-repos/protomaps__protomaps-leaflet/src/tilecache.ts
50. https://github.com/openlayers/openlayers/commit/e83813ceb; https://github.com/openlayers/openlayers/commit/279b9207a; https://github.com/openlayers/openlayers/commit/da475b0dc; https://github.com/openlayers/openlayers/commit/184939707
51. https://github.com/openlayers/openlayers/commit/796b2b837; https://github.com/openlayers/openlayers/commit/1d17b1ee1
52. https://github.com/openlayers/openlayers/pull/10807; https://github.com/openlayers/openlayers/issues/10799
53. ref-repos/MapServer__MapServer/src/apps/coshp.md; ref-repos/MapServer__MapServer/HISTORY.md
54. https://github.com/MapServer/MapServer/commit/294fe05c
55. https://github.com/MapServer/MapServer/pull/6520; https://github.com/MapServer/MapServer/issues/6550
56. https://github.com/MapServer/MapServer/commit/22cebf87; https://github.com/MapServer/MapServer/commit/f75f4ea2; https://github.com/MapServer/MapServer/commit/0462eeab
57. ref-repos/geoserver__geoserver/doc/en/user/community/cog/cog.md
58. https://github.com/geoserver/geoserver/pull/3856
59. ref-repos/mapsforge__mapsforge/docs/Specification-Binary-Map-File.md; ref-repos/mapsforge__mapsforge/mapsforge-map-reader/src/main/java/org/mapsforge/map/reader/IndexCache.java; ref-repos/mapsforge__mapsforge/mapsforge-map-reader/src/main/java/org/mapsforge/map/reader/MapFile.java
60. https://github.com/osmandapp/OsmAnd-core/commit/8989ea92
61. https://github.com/mapnik/mapnik/commit/2aa0ce9d7; https://github.com/mapnik/mapnik/commit/d81a7610d; https://github.com/mapnik/mapnik/commit/1f693b8fa
62. https://github.com/mapnik/mapnik/issues/1621
63. https://github.com/mapnik/mapnik/commit/0de6d3600; https://github.com/mapnik/mapnik/commit/6a9240f3d
64. ref-repos/OSGeo__grass/lib/gis/compress.c; ref-repos/OSGeo__grass/lib/raster/rasterlib.dox
65. https://github.com/OSGeo/grass/commit/10abcce89
66. ref-repos/NASAWorldWind__WorldWindJava/src/gov/nasa/worldwind/util/AbsentResourceList.java
67. https://github.com/pelicanmapping/osgearth/commit/ce00cd41a
68. https://github.com/qgis/QGIS/pull/42406
69. ref-repos/TerriaJS__terriajs/packages/terriajs/doc/connecting-to-data/item-search/indexed-item-search-provider-design-notes.md
70. https://github.com/openlayers/openlayers/pull/12008#issuecomment-803620507
71. https://github.com/CesiumGS/cesium/issues/6426; https://github.com/CesiumGS/cesium/issues/11627
72. https://fetch.spec.whatwg.org/#cors-safelisted-request-header; https://fetch.spec.whatwg.org/#forbidden-request-header
73. harness/lib/serve.ts
74. skills/map-from-scratch/references/spec-yaml.md
75. .agents/skills/yuiseki-open-data/SKILL.md
76. kits/geoparquet/zstd.ts
77. ref-repos/OSGeo__grass/doc/vector/TODO
78. https://github.com/mapnik/mapnik/blob/master/CHANGELOG.md; https://github.com/mapnik/mapnik/pull/3300; https://github.com/mapnik/mapnik/pull/3217
