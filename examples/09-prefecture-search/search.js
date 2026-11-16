export function findPrefecture(query, prefectures) {
    const text = query.trim();
    return text ? prefectures.findIndex(({ name })=>name.includes(text)) : -1;
}
