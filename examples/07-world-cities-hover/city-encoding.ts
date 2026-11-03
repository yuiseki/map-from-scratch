// Symbol radius in CSS px: area proportional to population, with a minimum
// marker size for places without population data.
export const R_MAX = 18;
export const R_MIN = 1.5;
export const POP_MAX = 35676000;
export const radius10 = (pop: number): number => Math.round(10 * Math.max(R_MIN, R_MAX * Math.sqrt(Math.max(0, pop) / POP_MAX)));

// Interleave the 16-bit x/y bits to sort nearby places next to one another.
export const morton = (x: number, y: number): bigint => {
  let m = 0n;
  for (let b = 15; b >= 0; b--) m = (m << 2n) | BigInt(((y >> b) & 1) << 1 | ((x >> b) & 1));
  return m;
};
