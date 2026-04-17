import { z } from "zod";

export const listRunEventsSchema = z.object({
  companyId: z.string().min(1),
  runId: z.string().min(1),
  offset: z.number().optional(),
  limit: z.number().optional(),
});
