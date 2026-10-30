// Plain C -> wasm32: no JS imports beyond what printf needs.
#include <stdio.h>

int main(void) {
  int sum = 0;
  for (int i = 1; i <= 10; i++) sum += i;
  printf("sum=%d\n", sum);
  return 0;
}
