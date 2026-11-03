import assert from 'node:assert/strict';
import test from 'node:test';
import { togglePanelRects } from './controls.ts';

test('interaction panel lays out three rows and checkboxes inside the panel', () => {
  const layout = togglePanelRects();
  assert.equal(layout.rows.length, 3);
  assert.equal(layout.panel.height, 118);
  assert.deepEqual(layout.checkboxes[0], { x: 22, y: 50, width: 14, height: 14 });
  assert.ok(layout.rows.every((row) => row.x === layout.panel.x && row.width === layout.panel.width));
});

test('interaction rows do not extend into the header or panel padding', () => {
  const layout = togglePanelRects();
  assert.ok(layout.rows[0].y > layout.panel.y);
  assert.ok(layout.rows.at(-1)!.y + layout.rows.at(-1)!.height < layout.panel.y + layout.panel.height);
});
