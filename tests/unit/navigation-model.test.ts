import { describe, expect, it } from "vitest";
import type { SectionId } from "@shared/types";
import {
  DASHBOARD_NAV_TARGETS,
  SECTION_NAV_IDS,
  SETTINGS_NAV_ITEM_DEF,
  SIDEBAR_NAV_GROUP_DEFS,
} from "../../src/renderer/navigation";

function sidebarSectionIds(): SectionId[] {
  return SIDEBAR_NAV_GROUP_DEFS.flatMap((group) => group.items.map((item) => item.id));
}

describe("renderer navigation model", () => {
  it("gives every section a stable visible entry", () => {
    const visibleIds = [...sidebarSectionIds(), SETTINGS_NAV_ITEM_DEF.id];

    expect(new Set(visibleIds).size).toBe(SECTION_NAV_IDS.length);
    expect(visibleIds).toEqual(expect.arrayContaining(SECTION_NAV_IDS));
  });

  it("keeps Dashboard targets reachable from the stable navigation model", () => {
    const visibleIds = new Set([...sidebarSectionIds(), SETTINGS_NAV_ITEM_DEF.id]);

    for (const sectionId of DASHBOARD_NAV_TARGETS) {
      expect(visibleIds.has(sectionId)).toBe(true);
    }
  });
});
