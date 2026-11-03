import assert from 'node:assert/strict';
import test from 'node:test';
import { selectCountyFlows, type FlowRecord } from './map.ts';

test('selected county shows only its outgoing records ordered by magnitude', () => {
  const flows: FlowRecord[] = [
    { s: 1, t: 2, v: 99 }, { s: 2, t: 1, v: -20 },
    { s: 2, t: 3, v: 8 }, { s: 2, t: 4, v: 3 },
  ];
  assert.deepEqual(selectCountyFlows(flows, 2), [flows[3], flows[2], flows[1]]);
});

test('selected county keeps only the strongest 200 flows while overview is capped at 300', () => {
  const flows = Array.from({ length: 350 }, (_, i) => ({ s: 1, t: i, v: i + 1 }));
  assert.equal(selectCountyFlows(flows, 1).length, 200);
  assert.equal(selectCountyFlows(flows, -1).length, 300);
});
