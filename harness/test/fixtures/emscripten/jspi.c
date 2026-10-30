// C that reads byte ranges through an asynchronous JS function, the shape a
// Range-request reader takes. Built with -sJSPI, read_range suspends the
// wasm stack on the JS promise and resumes it with the bytes; the C code is
// written as if the read were synchronous.
#include <emscripten.h>
#include <stdint.h>
#include <stdio.h>

// The bytes 0..255 stand in for a remote file. The JS side awaits a timer
// before copying, so the wasm stack really is suspended across a task.
EM_ASYNC_JS(int, read_range, (uint32_t offset, uint32_t length, uint8_t *out), {
  await new Promise((resolve) => setTimeout(resolve, 10));
  for (let i = 0; i < length; i++) HEAPU8[out + i] = (offset + i) & 255;
  return length;
});

int main(void) {
  uint8_t buf[16];
  uint32_t total = 0;
  for (uint32_t offset = 0; offset < 256; offset += 16) {
    int n = read_range(offset, 16, buf);
    for (int i = 0; i < n; i++) total += buf[i];
  }
  printf("jspi total=%u\n", total);
  return 0;
}
