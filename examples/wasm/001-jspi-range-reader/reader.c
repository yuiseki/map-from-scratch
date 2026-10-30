// examples/wasm/001-jspi-range-reader/reader.c
// Synchronous PMTiles v3 reader compiled to WebAssembly with -sJSPI.
// Every call to js_fetch_range suspends the WebAssembly call stack via JSPI,
// executes an asynchronous HTTP Range fetch in JavaScript, and resumes
// with the returned bytes directly into Wasm memory.
#include <emscripten.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

EM_ASYNC_JS(int, js_init_url, (const char *url_ptr), {
  window.__pmtiles_url = UTF8ToString(url_ptr);
  window.__jspi_range_reads = 0;
  window.__jspi_range_bytes = 0;
  return 0;
});

EM_ASYNC_JS(int, js_fetch_range, (uint32_t offset, uint32_t length, uint8_t *out_ptr), {
  const url = window.__pmtiles_url;
  try {
    const resp = await fetch(url, {
      headers: { Range: `bytes=${offset}-${offset + length - 1}` }
    });
    if (!resp.ok && resp.status !== 206) {
      console.error('JSPI HTTP error:', resp.status, resp.statusText);
      return -1;
    }
    const buf = await resp.arrayBuffer();
    HEAPU8.set(new Uint8Array(buf), out_ptr);
    window.__jspi_range_reads++;
    window.__jspi_range_bytes += buf.byteLength;
    return buf.byteLength;
  } catch (err) {
    console.error('JSPI fetch network exception:', err);
    return -2;
  }
});

typedef struct {
  uint64_t root_offset;
  uint64_t root_length;
  uint64_t data_offset;
  uint64_t data_length;
  uint8_t min_zoom;
  uint8_t max_zoom;
  uint8_t version;
} PMTilesHeaderInfo;

typedef struct {
  uint32_t tile_id;
  uint32_t offset;
  uint32_t length;
  uint32_t run_length;
} PMTilesEntry;

static PMTilesHeaderInfo header;
static PMTilesEntry *entries = NULL;
static uint32_t num_entries = 0;
static uint8_t *tile_buf = NULL;
static uint32_t tile_buf_capacity = 0;
static uint32_t last_tile_size = 0;
static uint32_t total_range_reads = 0;
static uint32_t total_range_bytes = 0;

static const uint32_t TZ[] = {0, 1, 5, 21, 85, 341, 1365};

static uint32_t zxy_to_tile_id(uint32_t z, uint32_t x, uint32_t y) {
  if (z >= sizeof(TZ) / sizeof(TZ[0])) return 0;
  uint32_t n = 1u << z;
  uint32_t d = 0;
  uint32_t xx = x;
  uint32_t yy = y;
  for (uint32_t s = n >> 1; s >= 1; s >>= 1) {
    uint32_t rx = (xx & s) ? 1 : 0;
    uint32_t ry = (yy & s) ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry == 0) {
      if (rx == 1) {
        xx = s - 1 - xx;
        yy = s - 1 - yy;
      }
      uint32_t t = xx;
      xx = yy;
      yy = t;
    }
  }
  return TZ[z] + d;
}

static uint64_t read_varint(const uint8_t *buf, uint32_t len, uint32_t *pos) {
  uint64_t v = 0;
  uint64_t shift = 1;
  while (*pos < len) {
    uint8_t b = buf[(*pos)++];
    v += (uint64_t)(b & 0x7f) * shift;
    shift *= 128;
    if (!(b & 0x80)) break;
  }
  return v;
}

static uint64_t read_uint64_le(const uint8_t *p) {
  uint64_t v = 0;
  for (int i = 0; i < 8; i++) {
    v |= ((uint64_t)p[i]) << (i * 8);
  }
  return v;
}

EMSCRIPTEN_KEEPALIVE
int init_reader(const char *url) {
  js_init_url(url);

  // 1. Read 127-byte header synchronously via JSPI
  uint8_t header_buf[127];
  int n = js_fetch_range(0, 127, header_buf);
  if (n != 127) {
    printf("Failed to read PMTiles header (got %d bytes)\n", n);
    return -1;
  }

  // Check magic "PMTiles"
  if (memcmp(header_buf, "PMTiles", 7) != 0) {
    printf("Invalid PMTiles magic\n");
    return -2;
  }

  header.version = header_buf[7];
  if (header.version != 3) {
    printf("Unsupported PMTiles version: %d\n", header.version);
    return -3;
  }

  header.root_offset = read_uint64_le(header_buf + 8);
  header.root_length = read_uint64_le(header_buf + 16);
  header.data_offset = read_uint64_le(header_buf + 56);
  header.data_length = read_uint64_le(header_buf + 64);
  header.min_zoom = header_buf[100];
  header.max_zoom = header_buf[101];

  total_range_reads++;
  total_range_bytes += 127;

  // 2. Read Root Directory synchronously via JSPI
  uint32_t dir_len = (uint32_t)header.root_length;
  uint8_t *dir_buf = (uint8_t*)malloc(dir_len);
  n = js_fetch_range((uint32_t)header.root_offset, dir_len, dir_buf);
  if (n != (int)dir_len) {
    printf("Failed to read root directory (got %d of %u bytes)\n", n, dir_len);
    free(dir_buf);
    return -4;
  }

  total_range_reads++;
  total_range_bytes += dir_len;

  // 3. Decode Varint Directory
  uint32_t pos = 0;
  num_entries = (uint32_t)read_varint(dir_buf, dir_len, &pos);
  if (entries) free(entries);
  entries = (PMTilesEntry*)malloc(sizeof(PMTilesEntry) * num_entries);

  // 1) Tile IDs (deltas)
  uint32_t last_id = 0;
  for (uint32_t i = 0; i < num_entries; i++) {
    last_id += (uint32_t)read_varint(dir_buf, dir_len, &pos);
    entries[i].tile_id = last_id;
  }

  // 2) Run lengths
  for (uint32_t i = 0; i < num_entries; i++) {
    entries[i].run_length = (uint32_t)read_varint(dir_buf, dir_len, &pos);
  }

  // 3) Lengths
  for (uint32_t i = 0; i < num_entries; i++) {
    entries[i].length = (uint32_t)read_varint(dir_buf, dir_len, &pos);
  }

  // 4) Offsets
  uint32_t current_offset = 0;
  for (uint32_t i = 0; i < num_entries; i++) {
    uint32_t delta = (uint32_t)read_varint(dir_buf, dir_len, &pos);
    if (i == 0) {
      current_offset = delta - 1; // first offset is encoded as offset + 1
    } else if (delta != 0) {
      current_offset = delta - 1;
    }
    entries[i].offset = current_offset;
    current_offset += entries[i].length;
  }

  free(dir_buf);
  return (int)num_entries;
}

EMSCRIPTEN_KEEPALIVE
void get_header_info(uint32_t *out_info) {
  // [version, min_zoom, max_zoom, num_entries, total_reads, total_bytes]
  out_info[0] = header.version;
  out_info[1] = header.min_zoom;
  out_info[2] = header.max_zoom;
  out_info[3] = num_entries;
  out_info[4] = total_range_reads;
  out_info[5] = total_range_bytes;
}

EMSCRIPTEN_KEEPALIVE
uint8_t* get_tile(uint32_t z, uint32_t x, uint32_t y) {
  uint32_t tile_id = zxy_to_tile_id(z, x, y);

  // Binary search directory
  int low = 0;
  int high = (int)num_entries - 1;
  int hit = -1;

  while (low <= high) {
    int mid = (low + high) / 2;
    PMTilesEntry *e = &entries[mid];
    if (tile_id >= e->tile_id && tile_id < e->tile_id + e->run_length) {
      hit = mid;
      break;
    }
    if (tile_id < e->tile_id) {
      high = mid - 1;
    } else {
      low = mid + 1;
    }
  }

  if (hit < 0) {
    last_tile_size = 0;
    return NULL;
  }

  PMTilesEntry *target = &entries[hit];
  uint32_t tile_len = target->length;

  if (tile_len > tile_buf_capacity) {
    tile_buf_capacity = tile_len + 2048;
    tile_buf = (uint8_t*)realloc(tile_buf, tile_buf_capacity);
  }

  uint32_t fetch_offset = (uint32_t)header.data_offset + target->offset;
  int n = js_fetch_range(fetch_offset, tile_len, tile_buf);
  if (n != (int)tile_len) {
    printf("Failed to fetch tile data at offset %u (got %d of %u bytes)\n", fetch_offset, n, tile_len);
    last_tile_size = 0;
    return NULL;
  }

  total_range_reads++;
  total_range_bytes += tile_len;
  last_tile_size = tile_len;
  return tile_buf;
}

EMSCRIPTEN_KEEPALIVE
uint32_t get_tile_size(void) {
  return last_tile_size;
}

EMSCRIPTEN_KEEPALIVE
void free_tile(uint8_t *ptr) {
  // static buffer, no-op
  (void)ptr;
}

int main(void) {
  return 0;
}
