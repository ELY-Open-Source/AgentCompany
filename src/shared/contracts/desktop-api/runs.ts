import type { z } from "zod";
import type { RunLogChunk, RunRecord } from "../../types";
import type { cancelRunSchema, runLogChunkSchema, runLogSchema, startRunSchema } from "../schemas-execution";
import type { entityGetterSchema } from "../schemas-badges";
import type { DesktopResult, RunEventRecord } from "./common";

export type RunsApi = {
  startTaskRun: (input: z.infer<typeof startRunSchema>) => Promise<DesktopResult<string>>;
  cancelRun: (input: z.infer<typeof cancelRunSchema>) => Promise<DesktopResult<boolean>>;
  getRunLog: (input: z.infer<typeof runLogSchema>) => Promise<DesktopResult<string>>;
  getRunLogChunk: (input: z.infer<typeof runLogChunkSchema>) => Promise<DesktopResult<RunLogChunk>>;
  getRun: (input: z.infer<typeof entityGetterSchema>) => Promise<DesktopResult<RunRecord>>;
  listRunEvents: (companyId: string, runId: string, opts?: { offset?: number; limit?: number }) => Promise<DesktopResult<RunEventRecord[]>>;
  recoveryRetry: (taskId: string, agentId: string, companyId: string) => Promise<DesktopResult<null>>;
  recoveryDismiss: (taskId: string, companyId: string) => Promise<DesktopResult<null>>;
  recoveryFail: (taskId: string, companyId: string) => Promise<DesktopResult<null>>;
};
