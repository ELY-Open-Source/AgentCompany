import { z } from "zod";

export const wakeupQuerySchema = z.object({
  companyId: z.string().uuid(),
  status: z.enum(["queued", "claimed", "coalesced", "deferred", "completed"]).optional(),
  agentId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export interface WakeupRequestRecord {
  id: string;
  companyId: string;
  agentId: string;
  source: string;
  triggerDetail: string | null;
  status: string;
  coalescedCount: number;
  runId: string | null;
  requestedAt: string;
  claimedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
