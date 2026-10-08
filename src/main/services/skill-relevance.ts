const LATIN_WORD = /[a-z0-9]{3,}/g;
const CJK_RUN = /[\u3400-\u9fff]+/g;

/** Words (latin, 3+ chars) and character pairs (CJK) of a text. */
function terms(text: string): Set<string> {
  const lower = text.toLowerCase();
  const found = new Set(lower.match(LATIN_WORD) ?? []);
  for (const run of lower.match(CJK_RUN) ?? []) {
    for (let index = 0; index < run.length - 1; index += 1) found.add(run.slice(index, index + 2));
  }
  return found;
}

/** Orders items by how many terms they share with the task; ties keep their order. */
export function orderByRelevance<T>(items: T[], describe: (item: T) => string, taskText: string): T[] {
  const taskTerms = terms(taskText);
  return items
    .map((item, index) => {
      let score = 0;
      for (const term of terms(describe(item))) if (taskTerms.has(term)) score += 1;
      return { item, index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.item);
}
