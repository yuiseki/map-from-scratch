import assert from 'node:assert/strict';
import test from 'node:test';
import { answerQuiz, shuffledIndices } from './quiz.ts';

test('quiz order is a permutation and uses the supplied random source', () => {
  assert.deepEqual(shuffledIndices(5, () => 0), [1, 2, 3, 4, 0]);
  const order = shuffledIndices(47, () => 0.37);
  assert.equal(new Set(order).size, 47);
  assert.deepEqual([...order].sort((a, b) => a - b), Array.from({ length: 47 }, (_, i) => i));
});

test('quiz ignores misses, marks wrong answers, advances correct answers and stops after completion', () => {
  const order = [4, 2];
  const initial = { current: 0, mistake: -1 };
  assert.deepEqual(answerQuiz(order, initial, -1), { state: initial, result: 'ignored' });
  assert.deepEqual(answerQuiz(order, initial, 3), { state: { current: 0, mistake: 3 }, result: 'wrong' });
  const next = answerQuiz(order, initial, 4);
  assert.deepEqual(next, { state: { current: 1, mistake: -1 }, result: 'correct' });
  assert.equal(answerQuiz(order, next.state, 2).state.current, 2);
  assert.equal(answerQuiz(order, { current: 2, mistake: -1 }, 1).result, 'finished');
});
