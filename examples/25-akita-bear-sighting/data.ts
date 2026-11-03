export const BASE_DATE = Date.UTC(2022, 3, 1);
export const MS_PER_DAY = 86400 * 1000;

export function parseDateToDays(dateStr: string): number {
  // Source format: "YYYY/M/D H:m" or "YYYY/MM/DD ...".
  const m = dateStr.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!m) return 0;
  const y = parseInt(m[1], 10), mo = parseInt(m[2], 10) - 1, d = parseInt(m[3], 10);
  const t = Date.UTC(y, mo, d);
  return Math.max(0, Math.floor((t - BASE_DATE) / MS_PER_DAY));
}

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQ && text[i + 1] === '"') { cur += '"'; i++; }
      else { inQ = !inQ; }
    } else if (c === ',' && !inQ) {
      row.push(cur);
      cur = '';
    } else if ((c === '\r' || c === '\n') && !inQ) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      cur = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else {
      cur += c;
    }
  }
  if (cur.length > 0 || row.length > 0) { row.push(cur); rows.push(row); }
  return rows;
}
