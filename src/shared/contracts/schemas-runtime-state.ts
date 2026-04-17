import { z } from "zod";

export const runtimeStateSchema = z.object({
  companyId: z.string().min(1),
  agentId: z.string().min(1),
});

export const setRuntimeStateSchema = z.object({
  companyId: z.string().min(1),
  agentId: z.string().min(1),
  state: z.record(z.string(), z.unknown()),
});
