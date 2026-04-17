import type { z } from "zod";
import type { AgentMetrics, AgentRecord } from "../../types";
import type { agentInputSchema, heartbeatSettingsSchema, hireRequestSchema, triggerHeartbeatSchema } from "../schemas-agents";
import type { entityGetterSchema, metricsQuerySchema } from "../schemas-badges";
import type { deleteEntitySchema } from "../schemas-badges";
import type { DesktopResult, HeartbeatPolicy } from "./common";

export type AgentsApi = {
  saveAgent: (input: z.infer<typeof agentInputSchema>) => Promise<DesktopResult<string>>;
  requestHire: (input: z.infer<typeof hireRequestSchema>) => Promise<DesktopResult<{ agentId: string; approvalId: string; autoApproved: boolean }>>;
  deleteAgent: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  getAgent: (input: z.infer<typeof entityGetterSchema>) => Promise<DesktopResult<AgentRecord>>;
  getAgentMetrics: (input: z.infer<typeof metricsQuerySchema>) => Promise<DesktopResult<AgentMetrics>>;
  setHeartbeat: (input: z.infer<typeof heartbeatSettingsSchema>) => Promise<DesktopResult<boolean>>;
  triggerHeartbeat: (input: z.infer<typeof triggerHeartbeatSchema>) => Promise<DesktopResult<string>>;
  getHeartbeatPolicy: (agentId: string, companyId: string) => Promise<DesktopResult<HeartbeatPolicy>>;
  setHeartbeatPolicy: (companyId: string, agentId: string, policy: Partial<HeartbeatPolicy>) => Promise<DesktopResult<boolean>>;
  getRuntimeState: (agentId: string, companyId: string) => Promise<DesktopResult<Record<string, unknown>>>;
  setRuntimeState: (companyId: string, agentId: string, state: Record<string, unknown>) => Promise<DesktopResult<boolean>>;
};
