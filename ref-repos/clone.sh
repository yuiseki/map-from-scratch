#!/usr/bin/env bash
# Clone the map engines, spatial libraries and data tools that
# map-from-scratch reads from.
#
#   ref-repos/clone.sh                 clone everything missing (shallow)
#   ref-repos/clone.sh --update        also bring existing clones up to date
#   ref-repos/clone.sh cesium deck.gl  only these (matched against the repo name)
#
# Environment:
#   JOBS=4     parallel clones
#   DEPTH=1    history depth; DEPTH=0 for full history
#
# Clones land in ref-repos/<owner>__<repo>/ and are not committed (see
# .gitignore). map-from-scratch is GPL-3.0-or-later, so code under GPL-3,
# GPL-2.0-or-later, LGPL and permissive licences may be adapted with
# attribution; GPL-2.0-only code may be read but not copied. The licence
# column below is a pointer: the repository's own files decide.
set -euo pipefail
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$SELF")"

# owner/repo                              kind              licence (as published)
REPOS=$(cat <<'EOF'
maplibre/maplibre-gl-js                   web-2d-3d         BSD-3-Clause
maplibre/maplibre-native                  native            BSD-2-Clause
maplibre/maplibre-rs                      rust              Apache-2.0/MIT
maplibre/maplibre-tile-spec               tile-format       Apache-2.0/MIT (code), CC0-1.0 (spec/docs); MLT successor of MVT
maplibre/navara                           web-3d-globe      see LICENSE
MapConductor/react-sdk                    sdk-umbrella      MIT
MapConductor/react-for-maplibre           sdk-adapter       Apache-2.0
MapConductor/react-for-openlayers         sdk-adapter       Apache-2.0
MapConductor/react-for-deckgl             sdk-adapter       Apache-2.0
MapConductor/react-for-cesium             sdk-adapter       Apache-2.0 (LICENSE)
MapConductor/android-sdk-core             sdk-core          Apache-2.0
MapConductor/android-for-maplibre         sdk-adapter       Apache-2.0
MapConductor/ios-sdk-core                 sdk-core          Apache-2.0
MapConductor/ios-for-maplibre             sdk-adapter       Apache-2.0
opengeos/RustGIS                          rust-gis          Apache-2.0
reearth/reearth-papers                    research          MIT
reearth/reearth-visualizer                web-3d-globe      Apache-2.0
CesiumGS/cesium                           web-3d-globe      Apache-2.0
Project-PLATEAU/PLATEAU-VIEW-4.0          web-3d-city       Apache-2.0
Project-PLATEAU/PLATEAU-VIEW-5.0          web-3d-city       Apache-2.0
visgl/deck.gl                             web-layers        MIT
kenjiyoshidahome2026-bit/ortho-earth      web-3d-globe      GPL-3.0-or-later (engine), MIT, CC BY-SA 4.0 (data); see README
qgis/QGIS                                 desktop-gis       GPL-2.0-or-later
OSGeo/grass                               desktop-gis       GPL-2.0-or-later
KDE/marble                                desktop-globe     LGPL-2.1
openlayers/openlayers                     web-2d            BSD-2-Clause
openlayers/ol2                            web-2d-historic   BSD-2-Clause
Leaflet/Leaflet                           web-2d            BSD-2-Clause
protomaps/protomaps-leaflet               web-2d            BSD-3-Clause
tangrams/tangram                          web-2d-3d         MIT
tangrams/tangram-es                       native            MIT
heremaps/harp.gl                          web-3d            Apache-2.0 (archived)
maptalks/maptalks.js                      web-2d-3d         MIT (package.json)
kothic/kothic-js                          web-2d-historic   BSD-2-Clause
stamen/modestmaps-js                      web-2d-historic   BSD (archived)
simplegeo/polymaps                        web-2d-historic   BSD
d3/d3-geo                                 projection        ISC
vasturiano/globe.gl                       web-3d-globe      MIT
openglobus/openglobus                     web-3d-globe      Apache-2.0
iTowns/itowns                             web-3d-globe      CeCILL-B/MIT
TerriaJS/terriajs                         web-3d-globe      Apache-2.0
melowntech/vts-browser-js                 web-3d-globe      BSD-2-Clause
NASAWorldWind/WebWorldWind                web-3d-globe      Apache-2.0 (PDF)
NASAWorldWind/WorldWindJava               desktop-globe     Apache-2.0 (PDF)
pelicanmapping/osgearth                   native-globe      MIT
mapnik/mapnik                             server-raster     LGPL-2.1
MapServer/MapServer                       server-raster     MIT-style
geoserver/geoserver                       server-raster     GPL-2.0 (only: not GPL-3 compatible)
tilemill-project/tilemill                 studio-historic   BSD-3-Clause
osmandapp/OsmAnd-core                     native-mobile     see LICENSE
organicmaps/organicmaps                   native-mobile     Apache-2.0
mapsforge/mapsforge                       native-mobile     LGPL-3.0
mapsforge/vtm                             native-mobile     LGPL-3.0
osmdroid/osmdroid                         native-mobile     Apache-2.0 (archived)
navit-gps/navit                           native-car        GPL-2.0/LGPL-2.0 (check before copying)
galileo-map/galileo                       rust              Apache-2.0/MIT
podusowski/walkers                        rust              MIT
SciTools/cartopy                          python-static     BSD-3-Clause
flopp/go-staticmaps                       go-static         MIT
protomaps/PMTiles                         tile-container    see LICENSE
protomaps/go-pmtiles                      tile-container    BSD-3-Clause
felt/tippecanoe                           tile-compiler     BSD-2-Clause
onthegomap/planetiler                    tile-compiler     Apache-2.0
openmaptiles/planetiler-openmaptiles      tile-schema       see LICENSE
systemed/tilemaker                       tile-compiler     see LICENSE
openmaptiles/openmaptiles                 tile-schema       see LICENSE
maptiler/tileserver-gl                   tile-server       see LICENSE
developmentseed/titiler                  raster-server     MIT
developmentseed/morecantile              tile-matrix       MIT
mapterhorn/mapterhorn                     terrain-tiles     BSD-3-Clause
PDAL/PDAL                                point-cloud       see LICENSE
OSGeo/gdal                               spatial-io        see LICENSE
OSGeo/PROJ                               projection        see LICENSE
libgeos/geos                             geometry          LGPL-2.1
google/s2geometry                        spatial-index     Apache-2.0
uber/h3                                  spatial-index     Apache-2.0
Turfjs/turf                              web-geometry      MIT
ibesora/vt-optimizer                     tile-optimizer    MIT
placemark/placemark                      web-geo-editor    MIT
osmandapp/OsmAnd                         native-mobile     see LICENSE
osmandapp/OsmAnd-iOS                     native-mobile     see LICENSE
osmandapp/OsmAnd-resources               map-resources     see LICENSE
osmcode/libosmium                        osm-pbf-library   BSL-1.0
osmcode/osmium-tool                      osm-pbf-tool      GPL-3.0
OvertureMaps/osm-pbf-parquet             osm-to-parquet    MIT
kraina-ai/quackosm                       osm-to-geoparquet Apache-2.0
osmcode/osmcoastline                     coastlines        GPL-3.0
GIScience/ohsome-planet                  osm-history       GPL-3.0
carbonplan/maps                          web-raster        see LICENSE
carderne/zarr-gl                         web-zarr          MIT
carbonplan/zarr-layer                    web-zarr          MIT
NOC-OI/zarr-cesium                       3d-zarr           MIT
nagix/mini-tokyo-3d                     web-3d-transit    MIT
nagix/japan-eq-locator                   web-3d-events     MIT
openinframap/openinframap                web-thematic      BSD-3-Clause
zhu-xlab/GlobalBuildingAtlas             building-data     check data terms
gboeing/osmnx                            osm-networks      MIT
geopandas/geopandas                      python-spatial    BSD-3-Clause
stac-utils/pystac                        stac-library      see LICENSE
apache/sedona-db                         spatial-db        Apache-2.0
pelias/pelias                            geocoder          MIT
komoot/photon                            geocoder          Apache-2.0
GeoDaCenter/geoda                        desktop-spatial   GPL-3.0
opengeos/GeoLibre                        web-gis           MIT
thkruz/keeptrack.space                   web-3d-sat        AGPL-3.0 (read only)
sentinel-hub/sentinelhub-js              imagery-client    MIT
sasgis/sas.planet.src                    desktop-imagery   GPL-3.0
originalankur/maptoposter                static-map        MIT
c2g-dev/city2graph                       spatial-graphs    BSD-3-Clause
shashwatak/satellite-js                  orbit-math        MIT
openstreetmap/id-tagging-schema          osm-schema        ISC
osmlab/name-suggestion-index             osm-catalog       BSD-3-Clause
EOF
)

UPDATE=0
FILTER=()
for a in "$@"; do
  case "$a" in
    --update) UPDATE=1 ;;
    -h|--help) sed -n '2,16p' "$SELF"; exit 0 ;;
    *) FILTER+=("$a") ;;
  esac
done
DEPTH=${DEPTH:-1}
DEPTH_ARGS=()
[[ "$DEPTH" != 0 ]] && DEPTH_ARGS=(--depth "$DEPTH" --single-branch)

one() {
  local repo=$1 dir=${1/\//__}
  if [[ -d "$dir/.git" ]]; then
    if [[ "$UPDATE" == 1 ]]; then
      git -C "$dir" fetch -q "${DEPTH_ARGS[@]:0:2}" origin && git -C "$dir" reset -q --hard FETCH_HEAD && echo "updated  $repo"
    else
      echo "present  $repo"
    fi
    return
  fi
  if git clone -q "${DEPTH_ARGS[@]}" "https://github.com/$repo.git" "$dir"; then
    local lic
    lic=$(ls -1 "$dir" | grep -i -E '^(licen[cs]e|copying)' | head -1 || true)
    echo "cloned   $repo  (${lic:-no licence file})"
  else
    echo "FAILED   $repo" >&2
    return 1
  fi
}
export -f one
export UPDATE DEPTH
export DEPTH_ARGS_STR="${DEPTH_ARGS[*]:-}"

selected=$(echo "$REPOS" | awk '{print $1}' | while read -r r; do
  if [[ ${#FILTER[@]} -eq 0 ]]; then echo "$r"; continue; fi
  for f in "${FILTER[@]}"; do if [[ "${r,,}" == *"${f,,}"* ]]; then echo "$r"; break; fi; done
done)
[[ -n "$selected" ]] || { echo "no repository matches: ${FILTER[*]}" >&2; exit 1; }

# xargs runs each clone in a fresh bash; rebuild the depth arguments there.
echo "$selected" | xargs -P "${JOBS:-4}" -I{} bash -c 'DEPTH_ARGS=($DEPTH_ARGS_STR); one "$@"' _ {}
