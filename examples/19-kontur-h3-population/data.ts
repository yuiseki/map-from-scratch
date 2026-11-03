export type Ring = [number, number][];
export interface Cell { h3: string; population: number; rings: Ring[]; box: [number, number, number, number] }
export interface PathBuilder { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; closePath(): void }

const COLORS = ['#325a6d', '#386f76', '#42877a', '#63a679', '#9fbd70', '#d7c970', '#e9aa61', '#e47a54', '#cb4e49'];
const BREAKS = [10, 100, 500, 2000, 10000, 50000, 200000, 1000000];
const classOf = (population: number): number => {
  const first = BREAKS.findIndex((b) => population < b);
  return first === -1 ? COLORS.length - 1 : first;
};

export function readCells(buffer: ArrayBuffer, paths: PathBuilder[]): Cell[] {
  const view = new DataView(buffer);
  if (String.fromCharCode(...new Uint8Array(buffer, 0, 4)) !== 'H3P1') throw new Error('H3 data version mismatch');
  const count = view.getUint32(4, true);
  const result: Cell[] = [];
  let at = 8;
  for (let i = 0; i < count; i++) {
    const h3 = view.getBigUint64(at, true).toString(16); at += 8;
    const population = view.getUint32(at, true); at += 4;
    const ringCount = view.getUint8(at++);
    const rings: Ring[] = [];
    const box: [number, number, number, number] = [65535, 65535, 0, 0];
    const path = paths[classOf(population)];
    for (let r = 0; r < ringCount; r++) {
      const n = view.getUint8(at++);
      const ring: Ring = [];
      for (let j = 0; j < n; j++) {
        const x = view.getUint16(at, true), y = view.getUint16(at + 2, true); at += 4;
        ring.push([x, y]);
        box[0] = Math.min(box[0], x); box[1] = Math.min(box[1], y);
        box[2] = Math.max(box[2], x); box[3] = Math.max(box[3], y);
        if (j === 0) path.moveTo(x, y); else path.lineTo(x, y);
      }
      path.closePath();
      rings.push(ring);
    }
    result.push({ h3, population, rings, box });
  }
  if (at !== buffer.byteLength) throw new Error('H3 data has trailing bytes');
  return result;
}
