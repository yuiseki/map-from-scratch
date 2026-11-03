import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCSV, parseDateToDays } from './data.ts';

test('date parser counts UTC days from the dataset epoch and clamps earlier dates', () => {
  assert.equal(parseDateToDays('2022/4/1 0:00'), 0);
  assert.equal(parseDateToDays('2022/04/02 12:30'), 1);
  assert.equal(parseDateToDays('2024/2/29'), Math.floor((Date.UTC(2024, 1, 29) - Date.UTC(2022, 3, 1)) / 86400000));
  assert.equal(parseDateToDays('2022/03/31 23:59'), 0);
  assert.equal(parseDateToDays('unknown'), 0);
});

test('CSV parser handles quoted commas, escaped quotes, CRLF and quoted newlines', () => {
  assert.deepEqual(parseCSV('date,place,desc\r\n2024/1/2,"Akita, City","said ""hello"""\r\n2024/1/3,North,"line 1\nline 2"'), [
    ['date', 'place', 'desc'],
    ['2024/1/2', 'Akita, City', 'said "hello"'],
    ['2024/1/3', 'North', 'line 1\nline 2'],
  ]);
  assert.deepEqual(parseCSV('a,b\n\nx,y\n'), [['a', 'b'], ['x', 'y']]);
});
