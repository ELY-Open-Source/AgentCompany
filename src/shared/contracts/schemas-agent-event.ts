import { z } from "zod";

/**
 * The renderer-bound `agent-event` push payload.
 *
 * The `event` payload is pi's AgentEvent (discriminated by `type`). We do not
 * mirror pi's type system in Zod (it would couple the renderer to pi's
 * internals); we validate the envelope and pass the event through opaquely.
 */
export const agentEventPushSchema = z.object({
  runId: z.string(),
  agentId: z.string(),
  companyId: z.string(),
  taskId: z.string().nullable(),
  emittedAt: z.string(),
  event: z.object({
    type: z.string(),
  }).passthrough(),
});
