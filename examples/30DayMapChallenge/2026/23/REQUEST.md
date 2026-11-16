# Request and design notes

## Request

30DayMapChallenge 2026 Day 23「Senses: Taste」。実在する場所のOpenStreetMap食関連タグから、浅草–上野周辺の「食の語彙」がどこに記録されているかを示す。味・品質・人気・営業状況は推定しない。OSMの `amenity`, `shop`, `cuisine` の原タグを明示し、空欄は未指定のまま扱う。

## Scope and source

固定元データは `hf:osm-tokyo23-src-2026-08`、2026-08-31のOpenStreetMap由来Tokyo 23-ward extractです。GeoParquet 1.1の`way`はEPSG:3857のメートル座標で、`bbox`はそのgeometryの範囲です。ローカルカードは `/sata_hdd_24tb/hf_data/__published/osm-tokyo23-src-2026-08/data/README.md` と `data/LICENSE`、列定義は `docs/schema-parquet.md` です。

AOIは `x=15559600..15566400`, `y=4256800..4263800`。概ね東経139.765–139.825度、北緯35.685–35.735度の浅草–上野を含みます。矩形は行政区界ではありません。source tableの空間bboxとAOIが交差するfeatureを対象とし、polygonにはさらに実geometryの交差判定を行います。polygon geometryはAOIで切り取り、point-on-surfaceを代表位置にします。

分類は描画用4群です: `amenity=restaurant|fast_food|food_court|ice_cream`を「食事」、`amenity=cafe`を「喫茶」、`amenity=bar|pub|biergarten|nightclub`を「酒場」、食物を扱う選択済み`shop=*`を「食料品店」とします。特に`shop=convenience`は範囲が広いタグであり、特定の品目や飲食提供の証拠としては読みません。原タグのcategory値は加工せず保持します。`cuisine`の文字列は明示タグをそのまま表示し、入力なしは未指定です。

## Reproducible data inventory

| Geometry source | Rows with bbox intersecting AOI | Any `amenity` or `shop` | Selected by listed tags |
| --- | ---: | ---: | ---: |
| `planet_osm_point` | 40,350 | 13,904 | 4,794 |
| `planet_osm_polygon` | 115,617 | 3,498 | 111 |
| Total | 155,967 | 17,402 | 4,905 |

The 12,497 tagged-but-unselected rows carry amenity/shop values outside the explicit lists. Rows with no food-related mapped tag are not eligible; they are not food records and are omitted before category filtering. No duplicate source keys appeared in this extent. Point and polygon tables are retained as distinct source geometry records; exact `(geometry table, OSM primitive ID)` duplicates would keep the first row. Point IDs are nodes; polygon IDs are ways or relations (osm2pgsql negative relation IDs are made positive and prefixed `relation/`).

Among the 4,905 selected features there are 2,312 eatery, 566 cafe, 1,080 drinks, and 947 food-shop records. `cuisine` appears on 1,909 records; 2,996 are explicitly left unspecified. The bake produces 643 occupied cells on a 220m square grid and 5,423 source-coordinate vertices (one per point plus clipped polygon vertices). The uncompressed baked JSON is 1,022,090 bytes. `stats.json` is the machine-readable inventory.

## Renderer choice

Canvas 2D is sufficient for 4,905 source features in one frozen AOI, with no GPU buffer construction or general map engine. Below 0.11 px/m, fixed 220m cells are subdivided into four consistent color slots, one per renderer group. Their per-group counts control opacity with `log1p(count)/log1p(maxCount)`; cell footprint always remains 220m, so count is not misrepresented as ground area. From 0.11 px/m, the aggregate switches to individual points; from 0.22 px/m, clipped polygon outlines are added. CPU hit testing finds the closest source point represented by the current view. This follows the repo's small-shape CPU picking guidance; a second ID render/readback is unnecessary.

Projection remains in EPSG:3857 for map geometry and affine screen transforms. Latitude/longitude is computed only for the live coordinate readout. A scale bar uses Mercator's local `cos(latitude)` factor. There is no background basemap: subtle coordinate-grid lines and two place labels provide orientation, while the feature distribution remains the subject.

This design does not model eating, customer counts, preferred cuisines, business quality, price, opening times, dietary suitability, or cultural authenticity. It does not claim that OSM exhaustively records the area. A `cuisine` tag describes what the mapper entered, not a verified menu.

## Provenance and legal notice

The local dataset card says the OSM extract and Parquet mirror are derivative databases under ODbL 1.0. The displayed dataset remains attributed to **© OpenStreetMap contributors**, links to the OSM copyright page, names the snapshot date, links the ODbL text, and declares share-alike for the derived database. Community mapping can be incomplete or stale; this renderer does not verify individual businesses.

## Verification and current status

The eight data-only tests cover tag classification, category grouping and scale-based detail transitions, exact-source duplicate handling, projected screen coordinates, AOI inclusion/exclusion, exact category aggregation and normalization, JSON geometry/tag/id round-trip validation, and screen-space hit selection. They ran under the repository's resource cap and pass. The source bake also ran with MemoryMax=8G, MemorySwapMax=0, CPUQuota=400%.

The browser check reads rendered pixels and exercises counts, group filters, source-tag inspection, pan/zoom, attribution/disclosures and external requests. After batching category paths and correcting scale thresholds for EPSG:3857 meter units, the capped 3-run benchmark passed all 10 budgets and all 6 checks. First frame p50 was 70.09 ms, draw CPU p95 2.035 ms, frame interval p95 8.855 ms, and data gzip 207,700 B. The 1280×800 screenshot was visually reviewed.
