import type { z } from "zod";
import type { AgentRecord } from "../../types";
import type { agentInputSchema, heartbeatSettingsSchema, hireRequestSchema, triggerHeartbeatSchema } from "../schemas-agents";
import type { entityGetterSchema } from "../schemas-badges";
import type { deleteEntitySchema } from "../schemas-badges";
import type { DesktopResult } from "./common";

export type AgentsApi = {
  saveAgent: (input: z.infer<typeof agentInputSchema>) => Promise<DesktopResult<string>>;
  requestHire: (input: z.infer<typeof hireRequestSchema>) => Promise<DesktopResult<{ agentId: string; approvalId: string; autoApproved: boolean }>>;
  deleteAgent: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  getAgent: (input: z.infer<typeof entityGetterSchema>) => Promise<DesktopResult<AgentRecord>>;
  setHeartbeat: (input: z.infer<typeof heartbeatSettingsSchema>) => Promise<DesktopResult<boolean>>;
  triggerHeartbeat: (input: z.infer<typeof triggerHeartbeatSchema>) => Promise<DesktopResult<string>>;
};
