const LATIN_WORD = /[a-z0-9]{3,}/g;
const CJK_RUN = /[\u3400-\u9fff]+/g;
const STOP_WORDS = new Set(["the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "you", "your", "our", "not", "but", "all", "any", "can", "has", "have", "had", "into", "its", "use", "will", "who", "how", "what", "when", "where", "which", "why", "out", "about", "than", "then", "them", "they", "their", "there", "these", "those", "been", "being", "each", "more", "most", "other", "some", "such", "only", "own", "same", "very", "just", "also"]);

/** Words (latin, 3+ chars) and character pairs (CJK) of a text. */
function terms(text: string): Set<string> {
  const lower = text.toLowerCase();
  const found = new Set((lower.match(LATIN_WORD) ?? []).filter((word) => !STOP_WORDS.has(word)));
  for (const run of lower.match(CJK_RUN) ?? []) {
    for (let index = 0; index < run.length - 1; index += 1) found.add(run.slice(index, index + 2));
  }
  return found;
}

function scored<T>(items: T[], describe: (item: T) => string, taskText: string) {
  const taskTerms = terms(taskText);
  return items
    .map((item, index) => {
      let score = 0;
      for (const term of terms(describe(item))) if (taskTerms.has(term)) score += 1;
      return { item, index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

/** Orders items by how many terms they share with the task; ties keep their order. */
export function orderByRelevance<T>(items: T[], describe: (item: T) => string, taskText: string): T[] {
  return scored(items, describe, taskText).map((entry) => entry.item);
}

/** Only the items sharing at least one term with the text, best first. */
export function relevantItems<T>(items: T[], describe: (item: T) => string, text: string, limit: number): T[] {
  return scored(items, describe, text).filter((entry) => entry.score > 0).slice(0, limit).map((entry) => entry.item);
}
