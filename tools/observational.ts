export interface Observation {
  id: string;
  date: string;
  duration_s: number;
  first_contentful_paint_ms: number;
  completed_requests: number;
  transfer_mib: number;
  note?: string;
}

export function formatObservation(o: Observation): string {
  const note = o.note ? `・${o.note}` : '';
  return `観測 ${o.date}・${o.duration_s}秒: FCP ${Math.round(o.first_contentful_paint_ms)} ms・${o.completed_requests} requests・${o.transfer_mib.toFixed(2)} MiB${note}`;
}
