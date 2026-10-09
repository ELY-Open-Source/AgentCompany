type ValueOf<T> = T[keyof T];

export const ROUTE_TO_TYPE = { EMPLOYEE: "employee", AGENT: "agent", BOARD: "board" } as const;
export type RouteToType = ValueOf<typeof ROUTE_TO_TYPE>;

export interface HiringPolicyRecord {
  id: string; orgId: string; departmentName: string; maxHeadcount: number;
  monthlyBudgetLimitCents: number; requireApprovalAboveCents: number; createdAt: string; updatedAt: string;
}

