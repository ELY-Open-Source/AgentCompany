import { useMemo } from "react"
import type { ApprovalRecord } from "@shared/types"
import { safeJson } from "../../../lib/safe-json"

export function useApprovalPayload(approval: ApprovalRecord): Record<string, unknown> | null {
  return useMemo(() => {
    if (!approval.payloadJson) return null
    const parsed = safeJson<unknown>(approval.payloadJson, null)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  }, [approval.payloadJson])
}

export function useSocialPlatform(approval: ApprovalRecord): string {
  const payload = useApprovalPayload(approval)
  return useMemo(() => {
    if (approval.type !== "social_post") return "other"
    const platform = payload?.platform
    return typeof platform === "string" ? platform : "other"
  }, [approval.type, payload])
}
