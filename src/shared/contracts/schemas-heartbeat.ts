import { z } from "zod";

export const heartbeatPolicySchema = z.object({
  companyId: z.string().min(1),
  agentId: z.string().min(1),
});

export const setHeartbeatPolicySchema = z.object({
  companyId: z.string().min(1),
  agentId: z.string().min(1),
  enabled: z.boolean().optional(),
  intervalSec: z.number().optional(),
  cooldownSec: z.number().optional(),
  maxConcurrentRuns: z.number().optional(),
  wakeOnDemand: z.boolean().optional(),
});
