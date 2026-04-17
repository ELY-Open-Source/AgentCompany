import { z } from "zod";

export const listConfigRevisionsSchema = z.object({
  companyId: z.string().uuid(),
  agentId: z.string().uuid(),
});

export const getConfigRevisionSchema = z.object({
  companyId: z.string().uuid(),
  revisionId: z.string().uuid(),
});

export const rollbackConfigRevisionSchema = z.object({
  companyId: z.string().uuid(),
  agentId: z.string().uuid(),
  revisionId: z.string().uuid(),
});
