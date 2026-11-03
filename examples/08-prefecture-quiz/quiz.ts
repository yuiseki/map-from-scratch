export function shuffledIndices(length: number, random: () => number = Math.random): number[] {
  const order = Array.from({ length }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

export interface QuizState { current: number; mistake: number }
export type QuizResult = 'ignored' | 'wrong' | 'correct' | 'finished';

export function answerQuiz(order: readonly number[], state: QuizState, picked: number): { state: QuizState; result: QuizResult } {
  if (state.current >= order.length) return { state, result: 'finished' };
  if (picked < 0) return { state, result: 'ignored' };
  if (picked !== order[state.current]) return { state: { ...state, mistake: picked }, result: 'wrong' };
  return { state: { current: state.current + 1, mistake: -1 }, result: 'correct' };
}
