import { z } from "zod";

export const getAgentPermissionsSchema = z.object({
  agentId: z.string().min(1),
});

export const setAgentPermissionSchema = z.object({
  companyId: z.string().min(1),
  agentId: z.string().min(1),
  permissionKey: z.string().min(1),
  enabled: z.boolean(),
});
