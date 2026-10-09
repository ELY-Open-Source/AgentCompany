import type { SearchPage, SearchResultRecord } from "../../../shared/domain";

/** The answer shown for one set of words: its hits so far, how many there are, and the last failure, if any. */
export interface SearchAnswer {
  key: string;
  results: SearchResultRecord[];
  total: number;
  error: string | null;
}

/** Adds a later page to the answer it was asked for; a page for other words is dropped, and a success clears an earlier failure. */
export function withNextPage(shown: SearchAnswer | null, asked: string, outcome: { page: SearchPage } | { error: string }): SearchAnswer | null {
  if (!shown || shown.key !== asked) return shown;
  if ("error" in outcome) return { ...shown, error: outcome.error };
  return { key: shown.key, results: [...shown.results, ...outcome.page.results], total: outcome.page.total, error: null };
}
