import { useMemo } from "react"
import type { ApprovalRecord } from "@shared/types"

export function useApprovalPayload(approval: ApprovalRecord): Record<string, unknown> | null {
  return useMemo(() => {
    if (!approval.payloadJson) return null
    try {
      const parsed = JSON.parse(approval.payloadJson)
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
      return null
    } catch {
      return null
    }
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
