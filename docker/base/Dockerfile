# Shared image for the harness, the bake steps and every renderer that
# does not need its own toolchain. A compiler only some examples need goes in
# its own image built on this one, docker/Dockerfile.<toolchain> (see
# docker/README.md), and the example names it in spec.yaml.
FROM node:24-trixie-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl unzip \
      build-essential \
      rustc cargo \
      chromium \
      libvulkan1 libegl1 libgles2 libegl-dev libgles-dev libx11-dev \
      clang lld llvm \
      gdal-bin \
      python3-venv \
      osmium-tool \
      procps \
      xvfb \
      fonts-noto-cjk \
 && rm -rf /var/lib/apt/lists/*

# DuckDB CLI for bake steps that read Parquet or GeoPackage (bake time only,
# never shipped). Extensions are installed into the image; the wrapper points
# every session at them, so a run needs no network for them.
RUN ARCH=$(dpkg --print-architecture) \
 && DUCKDB_ARCH=$([ "$ARCH" = "arm64" ] && echo "arm64" || echo "amd64") \
 && curl -fsSL -o /tmp/duckdb.gz "https://github.com/duckdb/duckdb/releases/download/v1.5.5/duckdb_cli-linux-${DUCKDB_ARCH}.gz" \
 && gunzip -c /tmp/duckdb.gz > /usr/local/lib/duckdb-cli && chmod +x /usr/local/lib/duckdb-cli && rm /tmp/duckdb.gz \
 && mkdir -p /opt/duckdb/extensions \
 && /usr/local/lib/duckdb-cli -c "SET extension_directory='/opt/duckdb/extensions'; INSTALL spatial; INSTALL httpfs;" \
 && chmod -R a+rX /opt/duckdb \
 && printf '#!/bin/sh\nexec /usr/local/lib/duckdb-cli -cmd "SET extension_directory='"'"'/opt/duckdb/extensions'"'"'" "$@"\n' > /usr/local/bin/duckdb \
 && chmod +x /usr/local/bin/duckdb

# Type checking only (bin/mfs test runs tsc --noEmit). Nothing here ships:
# Node runs .ts directly and the static server strips types for browsers.
RUN npm install -g --no-audit --no-fund typescript@6.0.3 @types/node@24.19.2

# LAZ decoding is used only while baking point-cloud examples.
RUN python3 -m venv /opt/mfs-python \
 && /opt/mfs-python/bin/pip install --no-cache-dir laspy==2.7.0 lazrs==0.8.2

# The harness's browser is stable Chrome, the one visitors of the site run.
# Debian's chromium package (still installed above, for the shared libraries
# Chrome needs) lags behind: it was at 156 when Chrome 157 shipped
# HTML-in-Canvas. Chrome for Testing is Google's build of a stable version,
# pinned here; to upgrade, change the version (see
# https://googlechromelabs.github.io/chrome-for-testing/).
ARG CHROME_VERSION=157.0.8103.38
RUN curl -fsSL -o /tmp/chrome.zip "https://storage.googleapis.com/chrome-for-testing-public/${CHROME_VERSION}/linux64/chrome-linux64.zip" \
 && unzip -q /tmp/chrome.zip -d /opt && mv /opt/chrome-linux64 /opt/chrome && rm /tmp/chrome.zip \
 && /opt/chrome/chrome --version
ENV CHROME_BIN=/opt/chrome/chrome
