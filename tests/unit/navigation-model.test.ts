import { describe, expect, it } from "vitest";
import type { SectionId } from "@shared/types";
import {
  COMMAND_PALETTE_NAV_ITEM_DEFS,
  DASHBOARD_NAV_TARGETS,
  SECTION_NAV_IDS,
  SETTINGS_NAV_ITEM_DEF,
  SIDEBAR_NAV_GROUP_DEFS,
} from "../../src/renderer/navigation";

function sidebarSectionIds(): SectionId[] {
  return SIDEBAR_NAV_GROUP_DEFS.flatMap((group) => group.items.map((item) => item.id));
}

describe("renderer navigation model", () => {
  it("keeps the sidebar focused on the primary user journey", () => {
    expect(sidebarSectionIds()).toEqual([
      "overview",
      "inbox",
      "tasks",
      "approvals",
      "agents",
      "communication",
      "documents",
    ]);
  });

  it("keeps every section reachable from command navigation", () => {
    const commandIds = COMMAND_PALETTE_NAV_ITEM_DEFS.map((item) => item.id);

    expect(new Set(commandIds).size).toBe(SECTION_NAV_IDS.length);
    expect(commandIds).toEqual(expect.arrayContaining(SECTION_NAV_IDS));
  });

  it("keeps Dashboard targets reachable from command navigation", () => {
    const commandIds = new Set(COMMAND_PALETTE_NAV_ITEM_DEFS.map((item) => item.id));

    for (const sectionId of DASHBOARD_NAV_TARGETS) {
      expect(commandIds.has(sectionId)).toBe(true);
    }
  });

  it("keeps settings outside the scrollable sidebar groups", () => {
    expect(sidebarSectionIds()).not.toContain(SETTINGS_NAV_ITEM_DEF.id);
  });
});
