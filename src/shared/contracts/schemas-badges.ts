import { z } from "zod";

export const deleteEntitySchema = z.object({
  id: z.string().uuid(),
  companyId: z.string().uuid(),
});

export const entityGetterSchema = z.object({
  companyId: z.string().uuid(),
  id: z.string().uuid(),
});

export const metricsQuerySchema = z.object({
  companyId: z.string().uuid(),
  agentId: z.string().uuid().optional(),
  days: z.number().int().min(1).max(90).default(30),
});

// `SidebarBadges` and its Zod schema used to live here as an IPC
// response type. Sidebar badges are now derived in the renderer from
// `ProfileSnapshot` (see `src/shared/sidebar-badges.ts`), so no wire
// contract is needed — `deriveSidebarBadges(snapshot)` is the only
// path that produces a `SidebarBadges` value.
