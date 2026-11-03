export interface SearchPrefecture { name: string; code: string }

export function findPrefecture(query: string, prefectures: readonly SearchPrefecture[]): number {
  const text = query.trim();
  return text ? prefectures.findIndex(({ name }) => name.includes(text)) : -1;
}
