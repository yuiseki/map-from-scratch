import assert from 'node:assert/strict';
import test from 'node:test';
import { checkboxRect, panelRect, rowRect } from './controls.ts';

test('the panel grows by one row height per toggle', () => {
  assert.equal(panelRect(3).height, 118);
  assert.equal(panelRect(4).height - panelRect(3).height, rowRect(1).y - rowRect(0).y);
  assert.equal(panelRect(2).height, panelRect(3).height - (rowRect(1).y - rowRect(0).y));
});

test('rows fill the panel below the header, each checkbox inside its row', () => {
  const n = 3, panel = panelRect(n);
  const first = rowRect(0), last = rowRect(n - 1);
  assert.ok(first.y > panel.y);
  assert.ok(last.y + last.height < panel.y + panel.height);
  for (let i = 0; i < n; i++) {
    const row = rowRect(i), box = checkboxRect(i);
    assert.equal(row.x, panel.x);
    assert.equal(row.width, panel.width);
    assert.ok(box.y >= row.y && box.y + box.height <= row.y + row.height);
  }
  assert.deepEqual(checkboxRect(0), { x: 22, y: 50, width: 14, height: 14 });
});
