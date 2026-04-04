import { describe, expect, it } from "vitest";
import {
  mergeConnectorModelEntries,
  resolveSelectedConnectorModel,
} from "@shared/connector-models";

describe("connector model helpers", () => {
  it("merges enabled and disabled models into one toggle list", () => {
    const entries = mergeConnectorModelEntries(
      [
        { id: "gpt-5.4", label: "GPT-5.4" },
        { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
      ],
      [{ id: "o4-mini", label: "o4-mini" }],
    );

    expect(entries).toEqual([
      { id: "gpt-5.4", label: "GPT-5.4", enabled: true },
      { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", enabled: true },
      { id: "o4-mini", label: "o4-mini", enabled: false },
    ]);
  });

  it("keeps the current selection only if it remains enabled", () => {
    const entries = mergeConnectorModelEntries(
      [{ id: "gpt-5.4", label: "GPT-5.4" }],
      [{ id: "gpt-5.4-mini", label: "GPT-5.4 Mini" }],
    );

    expect(resolveSelectedConnectorModel(entries, "gpt-5.4")).toBe("gpt-5.4");
    expect(resolveSelectedConnectorModel(entries, "gpt-5.4-mini")).toBe("gpt-5.4");
    expect(resolveSelectedConnectorModel(entries, "")).toBe("gpt-5.4");
  });

  it("dedupes duplicate ids and keeps enabled entries ahead of disabled ones", () => {
    const entries = mergeConnectorModelEntries(
      [{ id: "gpt-5.4", label: "GPT-5.4" }],
      [
        { id: "gpt-5.4", label: "GPT-5.4" },
        { id: "gpt-4.1", label: "GPT-4.1" },
      ],
    );

    expect(entries).toEqual([
      { id: "gpt-5.4", label: "GPT-5.4", enabled: true },
      { id: "gpt-4.1", label: "GPT-4.1", enabled: false },
    ]);
  });

  it("returns an empty selection when all entries are disabled", () => {
    const entries = mergeConnectorModelEntries([], [{ id: "gpt-5.4", label: "GPT-5.4" }]);

    expect(resolveSelectedConnectorModel(entries, "gpt-5.4")).toBe("");
  });
});
