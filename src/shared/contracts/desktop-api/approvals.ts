import type { z } from "zod";
import type { ApprovalRecord } from "../../types";
import type { approvalDecisionSchema, approvalInputSchema } from "../schemas-approvals";
import type { deleteEntitySchema, entityGetterSchema } from "../schemas-badges";
import type { DesktopResult } from "./common";

export type ApprovalsApi = {
  requestApproval: (input: z.infer<typeof approvalInputSchema>) => Promise<DesktopResult<string>>;
  decideApproval: (input: z.infer<typeof approvalDecisionSchema>) => Promise<DesktopResult<boolean>>;
  deleteApproval: (input: z.infer<typeof deleteEntitySchema>) => Promise<DesktopResult<boolean>>;
  getApproval: (input: z.infer<typeof entityGetterSchema>) => Promise<DesktopResult<ApprovalRecord>>;
};
