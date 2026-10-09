import { describe, expect, test } from "vitest";
import { withNextPage, type SearchAnswer } from "../../src/renderer/src/shared/search-pages";

const hit = (id: string) => ({ entityType: "task" as const, entityId: id, title: id, preview: "", facets: {} });

describe("search pages", () => {
  test("a later page joins its own answer; a success after a failure clears the failure", () => {
    const shown: SearchAnswer = { key: "org|all|lantern", results: [hit("a")], total: 3, error: null };
    const failed = withNextPage(shown, "org|all|lantern", { error: "IPC failed" });
    expect(failed).toEqual({ ...shown, error: "IPC failed" });
    const recovered = withNextPage(failed, "org|all|lantern", { page: { results: [hit("b"), hit("c")], total: 3 } });
    expect(recovered).toEqual({ key: "org|all|lantern", results: [hit("a"), hit("b"), hit("c")], total: 3, error: null });
    // A page asked for other words never lands in this answer.
    expect(withNextPage(recovered, "org|all|other", { page: { results: [hit("z")], total: 9 } })).toBe(recovered);
    expect(withNextPage(null, "org|all|lantern", { page: { results: [hit("z")], total: 1 } })).toBeNull();
  });
});
