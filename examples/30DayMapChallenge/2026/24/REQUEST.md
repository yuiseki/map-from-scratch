# Day 24 · Network — Request and data decisions

## Request

2026年の30DayMapChallenge「Network」として、東京都のバス網を実データから専用描画器で見せる。事業者別に線の空間的な広がりを比べられ、停留所の位置と記録された系統数から乗換点らしい構造を読めるようにする。時刻表や現在の便案内を装わない。

## Sources reviewed before implementation

`yuiseki-open-data` skill/catalogと各データカード、列説明、LICENSEを確認した。

| Source | Local file | Source fields and meaning | Licence / required credit |
| --- | --- | --- | --- |
| KSJ N07 2022, Tokyo | `/sata_hdd_24tb/hf_data/ksj-n07-bus-route-greater-tokyo/data/parquet/prefectures/13.parquet` | GeoParquet 1.1, EPSG:6668; `id`, `operator`, `pref_code`, `pref`, `geometry` (WKB LineString). Line geometry, not a route/itinerary identifier. No route names or schedules in this edition. | CC BY 4.0; `出典：「国土数値情報（バスルートデータ）」（国土交通省）（https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N07-v2_0.html）を加工して作成` |
| KSJ P11 2022, Tokyo | `/sata_hdd_24tb/hf_data/ksj-p11-bus-stop-jp/data/parquet/prefectures/13.parquet` | GeoParquet 1.1, EPSG:6668; `id`, `name`, `operator`, `routes[]`, `kinds[]`, `n_routes`, `geometry` (WKB Point). Route labels and class codes are parallel arrays; P11 does not encode stop order along a route. | CC BY 4.0; `出典：「国土数値情報（バス停留所データ）」（国土交通省）（https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-P11-v3_0.html）を加工して作成` |

Both rows were inspected under `systemd-run --user --scope -q -p MemoryMax=8G -p MemorySwapMax=0 -p CPUQuota=400% -- ...`; observed geometries have x=longitude and y=latitude. The local data cards report all Japan totals and contain source material, schema provenance, terms, and processing notes.

## Fixed view and relation semantics

AOI is the half-open-style display frame `139.55 <= longitude <= 139.95`, `35.52 <= latitude <= 35.82`. It is an urban Tokyo focus rectangle, not an administrative polygon or a bus coverage claim. The Tokyo prefecture records contain outlying islands, which are outside this frame.

The source IDs belong to separate N07 and P11 layers and do not provide a proven cross-table join. N07 line records stay independent from P11 stops. Within P11 only, each explicit `routes[]` item creates a stop-to-label incidence keyed by exact `(operator, label)` text. This grouping can show repeated source wording; it does not establish one globally unique route, line correspondence, ordered path, direction, departures, frequency, or current operation. `n_routes` comes from P11 as published and is not recomputed from N07 lines.

Source inventory inspection for the frame found 9,545 intersecting Tokyo N07 LineStrings from 17,540 and 6,664 P11 stop points from 12,389. The stops carry 15,286 route-label memberships. 3,180 have at least two recorded labels and the maximum `n_routes` is 27. The frame contains 57 operators in each dataset and 915 distinct exact `(operator, label)` groups. These are source-query findings, to be independently checked against the deterministic bake output before publication.

The capped deterministic bake now reproduces those values. It records 87,107 retained N07 clip vertices and writes a 5,637,159-byte network JSON plus source/count provenance in `stats.json`. Three capped browser runs passed all checks and budgets. First-frame p50 was 304.5 ms, draw CPU p95 12.13 ms, frame interval p95 15.78 ms, data gzip 1,458,086 B, and there were zero external-origin requests. Maximum frame interval was 84.35 ms; the p95 result does not guarantee every frame stayed within budget.

## Interaction and limits

- Canvas 2D, no generic map engine and no basemap tiles.
- Draw N07 source polylines and P11 source points as separate layers.
- Point radius indicates the P11 `n_routes` field. Operator filtering uses the exact source operator field.
- Stop selection exposes its exact ID, name, operator, route-list entries, class-code list and `n_routes`.
- Pan by drag or arrow keys, zoom by wheel/buttons/`+`/`-`, reset with `Home`.
- 2022 snapshot only. Do not infer current service, timetable, frequency, vehicle capacity, route direction, line-to-stop topological connection, or ground-truth travel path.
