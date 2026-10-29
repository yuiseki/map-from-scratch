// Raw data shared by the examples, converted once into data/raw/.
// Each source names a local copy (used when present, e.g. on yuisekin-z) and
// where the same file comes from otherwise. Bake steps call source(name).
import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rawDir = join(root, 'data/raw');
const NE = '/sata_hdd_24tb/hf_data/__published/ne-admin0-10m/v5.1.1/shapefile';

interface Source { out: string; local: string; remote?: string; ogr?: string[]; copy?: boolean }

const SOURCES: Record<string, Source> = {
  // Paris Data les-arbres, ODbL; fixed copy used by the deck.gl GridLayer example.
  'deckgl-paris-trees': {
    out: 'deckgl_paris_trees.csv',
    local: '/sata_hdd_24tb/hf_data/deckgl-paris-trees/les-arbres.csv',
    remote: 'https://raw.githubusercontent.com/visgl/deck.gl-data/0535921160bdcd57ef55c712669c5a4d5eedbb3c/examples/scatterplot/les-arbres.csv',
    copy: true,
  },
  // D3 GeoTIFF contours notebook attachment; GRIB metadata identifies a 2016 surface-temperature forecast.
  'd3-geotiff-sfctmp': {
    out: 'd3_geotiff_sfctmp.tiff',
    local: '/sata_hdd_24tb/hf_data/d3-geotiff-contours/sfctmp.tiff',
    remote: 'https://static.observableusercontent.com/files/6954c8d84aa4a9b4de4dfcc4cbe86556571ecdcbbac8f587cc98207c9a613b03ad260859f796a61b2facf50b50038f113c8cd5f55c4fbe1e2c1bc785e8ac3805',
    copy: true,
  },
  // deck.gl ContourLayer demo: county weekly COVID-19 reports derived from NYT data.
  'deckgl-contour-covid': {
    out: 'deckgl_contour_covid_by_county.json',
    local: '/sata_hdd_24tb/hf_data/deckgl-contour-covid/covid-by-county.json',
    remote: 'https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/contour/covid-by-county.json',
    copy: true,
  },
  // MapLibre cluster demo: the fixed USGS earthquake GeoJSON used by the official example.
  'maplibre-cluster-earthquakes': {
    out: 'maplibre_cluster_earthquakes.geojson',
    local: '/sata_hdd_24tb/hf_data/maplibre-cluster-earthquakes/earthquakes.geojson',
    remote: 'https://maplibre.org/maplibre-gl-js/docs/assets/earthquakes.geojson',
    copy: true,
  },
  // Natural Earth 110m land, public domain: geographic context for the cluster demo.
  'ne-110m-land': {
    out: 'ne_110m_land.geojson',
    local: '/sata_hdd_24tb/hf_data/natural-earth-110m/ne_110m_land.geojson',
    remote: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson',
    copy: true,
  },
  // deck.gl TripsLayer demo: NYC taxi paths and Mapzen/OSM building footprints.
  'deckgl-trips-nyc': {
    out: 'deckgl_trips_nyc.json',
    local: '/sata_hdd_24tb/hf_data/deckgl-trips/trips-v7.json',
    remote: 'https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/trips/trips-v7.json',
    copy: true,
  },
  'deckgl-trips-buildings': {
    out: 'deckgl_trips_buildings.json',
    local: '/sata_hdd_24tb/hf_data/deckgl-trips/buildings.json',
    remote: 'https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/trips/buildings.json',
    copy: true,
  },
  // deck.gl HexagonLayer demo: 140,000 UK personal-injury road accidents.
  'deckgl-uk-road-accidents': {
    out: 'deckgl_uk_road_accidents.csv',
    local: '/sata_hdd_24tb/hf_data/deckgl-uk-road-accidents/heatmap-data.csv',
    remote: 'https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/3d-heatmap/heatmap-data.csv',
    copy: true,
  },
  // deck.gl ScreenGridLayer demo: 100,000 weighted NYC Uber pickup locations.
  'deckgl-screen-grid-uber': {
    out: 'deckgl_screen_grid_uber_pickups.json',
    local: '/sata_hdd_24tb/hf_data/deckgl-screen-grid-uber/uber-pickup-locations.json',
    remote: 'https://raw.githubusercontent.com/visgl/deck.gl-data/master/examples/screen-grid/uber-pickup-locations.json',
    copy: true,
  },
  // Kontur Population 2023-11-01, H3 resolution 4, CC BY.
  'kontur-population-r4': {
    out: 'kontur_population_20231101_r4.parquet',
    local: '/sata_hdd_24tb/hf_data/kontur-population-2023-11-01-22km/data/parquet/kontur_population_20231101_r4.parquet',
    remote: 'https://huggingface.co/datasets/yuiseki/kontur-population-2023-11-01-22km/resolve/main/parquet/kontur_population_20231101_r4.parquet',
    copy: true,
  },
  // UCDP Georeferenced Event Dataset 26.1, CC BY 4.0 with publication citations.
  'ucdp-ged-26.1': {
    out: 'ucdp_ged_26.1.parquet',
    local: '/sata_hdd_24tb/hf_data/__published/ucdp-ged/data/parquet/26.1/ged.parquet',
    remote: 'https://huggingface.co/datasets/yuiseki/ucdp-ged/resolve/main/parquet/26.1/ged.parquet',
    copy: true,
  },
  // Natural Earth 10m admin 0, v5.1.1. Public domain.
  'ne-countries': {
    out: 'ne_10m_admin_0_countries.geojson',
    local: `${NE}/ne_10m_admin_0_countries.shp`,
    remote: '/vsizip//vsicurl/https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.zip',
    ogr: ['-select', 'ADM0_A3,NAME,NAME_JA,POP_EST,CONTINENT'],
  },
  // Natural Earth 10m admin 0 land boundary lines, v5.1.0. Public domain.
  'ne-boundary-lines': {
    out: 'ne_10m_admin_0_boundary_lines_land.geojson',
    local: `${NE}/ne_10m_admin_0_boundary_lines_land.shp`,
    remote: '/vsizip//vsicurl/https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_boundary_lines_land.zip',
    ogr: ['-select', 'FEATURECLA'],
  },
  // Natural Earth 10m admin 1, Japan only (47 prefectures). Public domain.
  'ne-japan-prefectures': {
    out: 'ne_10m_japan_prefectures.geojson',
    local: `${NE}/ne_10m_admin_1_states_provinces.shp`,
    remote: '/vsizip//vsicurl/https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_1_states_provinces.zip',
    ogr: ['-where', "adm0_a3 = 'JPN'", '-select', 'iso_3166_2,name,name_ja,region'],
  },
  // Natural Earth 10m populated places, v5.1.2 (7,342 places). Public domain.
  'ne-populated-places': {
    out: 'ne_10m_populated_places.geojson',
    local: '/sata_hdd_24tb/yuisekinai-data/gazetteer/ne_pp/ne_10m_populated_places.shp',
    remote: '/vsizip//vsicurl/https://naciscdn.org/naturalearth/10m/cultural/ne_10m_populated_places.zip',
    ogr: ['-select', 'NAME,NAME_JA,ADM0NAME,ADM0_A3,POP_MAX'],
  },
  // USGS ComCat, 2025, M4.5+. Public domain (US Government work).
  'usgs-quakes-2025': {
    out: 'usgs_2025_m45.geojson',
    local: '/sata_hdd_24tb/hf_data/usgs-earthquake-catalog-2025-m45/data/raw/2026-10-25/comcat-2025-m45-us-net.geojson',
    remote: 'https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&starttime=2025-01-01&endtime=2026-01-01&minmagnitude=4.5&eventtype=earthquake',
    copy: true,
  },
  // Akita prefecture kumadas wildlife sightings (bear, boar, deer) 2022-2026. CC BY 4.0.
  'akita-kumadas': {
    out: 'akita_kumadas.csv',
    local: '/sata_hdd_24tb/hf_data/akita-kumadas-wildlife-sighting/data/raw/2026-10-26/kumadas.csv',
    remote: 'https://huggingface.co/datasets/yuiseki/akita-kumadas-wildlife-sighting/resolve/main/raw/2026-10-26/kumadas.csv',
    copy: true,
  },
  // OpenStreetMap, Tokyo 23 wards, 2026-08-31. ODbL. Only a local copy:
  // elsewhere, cut it from a Japan extract with osmium extract.
  'osm-tokyo23': {
    out: 'tokyo23-260831.osm.pbf',
    local: '/sata_hdd_24tb/hf_data/__published/osm-tokyo23-src-2026-08/data/tokyo23-260831.osm.pbf',
    copy: true,
  },
};

export function source(name: string): string {
  const s = SOURCES[name];
  if (!s) throw new Error(`unknown source ${name}`);
  const out = join(rawDir, s.out);
  // The conversion settings are kept next to the output; when they change
  // (another -select, a new remote) the file is converted again.
  const stamp = `${out}.source.json`;
  const settings = JSON.stringify({ local: s.local, remote: s.remote, ogr: s.ogr, copy: s.copy });
  if (existsSync(out) && existsSync(stamp) && readFileSync(stamp, 'utf8') === settings) return out;
  mkdirSync(rawDir, { recursive: true });
  const from = existsSync(s.local) ? s.local : s.remote;
  if (!from) throw new Error(`${name}: no local copy at ${s.local} and no remote`);
  console.log(`source ${name} <- ${from}`);
  rmSync(out, { force: true });
  if (s.copy && from === s.local) {
    copyFileSync(from, out);
  } else if (s.copy) {
    execFileSync('curl', ['-fsSL', '-o', out, from], { stdio: 'inherit' });
  } else {
    execFileSync('ogr2ogr', ['-f', 'GeoJSON', '-t_srs', 'EPSG:4326', '-lco', 'COORDINATE_PRECISION=6', ...(s.ogr ?? []), out, from], { stdio: 'inherit' });
  }
  writeFileSync(stamp, settings);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const name of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SOURCES)) {
    console.log(source(name));
  }
}
