#!/usr/bin/env bash
# Publish the browser examples to GitHub Pages.
#
#   tools/deploy-pages.sh            build, check, push to gh-pages
#   tools/deploy-pages.sh --no-check skip the browser check of the built site
#
# The data is baked on this machine (the sources are local), so the site is
# built here and pushed as a single-commit gh-pages branch: each deploy
# replaces the branch, and its history never grows.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
REMOTE=$(git remote get-url origin)
REPO=$(echo "$REMOTE" | sed -E 's#.*github.com[:/]##; s#\.git$##')

docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$ROOT:$ROOT" -w "$ROOT" mfs-base \
  node --disable-warning=ExperimentalWarning tools/build-site.ts
if [[ "${1:-}" != --no-check ]]; then
  for id in $(bin/mfs list | grep -E '^[0-9a-z]' ); do
    site_dir=".cache/site/examples/$id"
    for source in maplibre leaflet deckgl d3 mapbox cesium openglobus tangram; do
      [[ "$id" == "$source-"* ]] && site_dir=".cache/site/examples/$source/${id#"$source-"}"
    done
    [[ -d "$site_dir" || -d ".cache/site/baselines/$id" ]] || continue
    bin/mfs bench "$id" -n 1 --site >/tmp/mfs-site-check.log 2>&1 || { cat /tmp/mfs-site-check.log; echo "site check failed: $id"; exit 1; }
  done
fi

TMP=$(mktemp -d "$ROOT/.cache/mfs-deploy-XXXXXXXX")
trap 'rm -rf "$TMP"' EXIT
cp -a .cache/site/. "$TMP/"
git -C "$TMP" init -q -b gh-pages
git -C "$TMP" add -A
git -C "$TMP" -c user.name="$(git config user.name)" -c user.email="$(git config user.email)" \
  commit -q -m "Site built from $(git rev-parse --short HEAD)"
git -C "$TMP" push -q --force "$REMOTE" gh-pages

# Turn Pages on the first time (branch gh-pages, root).
# Pushing a gh-pages branch may already have turned it on (HTTP 409).
if ! gh api "repos/$REPO/pages" >/dev/null 2>&1; then
  gh api -X POST "repos/$REPO/pages" -f 'source[branch]=gh-pages' -f 'source[path]=/' >/dev/null 2>&1 \
    || gh api "repos/$REPO/pages" >/dev/null
fi
echo "https://$(echo "$REPO" | cut -d/ -f1).github.io/$(echo "$REPO" | cut -d/ -f2)/"
