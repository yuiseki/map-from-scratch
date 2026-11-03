#include <assert.h>
#include <stdint.h>
#include "mcumap.h"

const int16_t mm_pts[] = {-10, 0, 10, 0};
const mm_road mm_roads[] = {{-10, 0, 10, 0, 0, 2, 0}};
const uint16_t mm_road_count = 1;

int main(void) {
  uint16_t strip[MM_W * MM_STRIP];
  mm_stats stats = {0, 0, 0};
  const mm_view view = {0, 0, 192};
  mm_render_strip(&view, 112, strip, &stats);

  assert(strip[8 * MM_W + MM_W / 2] == 0xE30B);  // motorway red at the view centre
  assert(strip[0] != 0xE30B);                    // untouched background remains
  assert(stats.roads_tested == 1);
  assert(stats.segments_drawn == 1);
  assert(stats.pixels > 0);
  return 0;
}
