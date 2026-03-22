import { Clock, Link as LinkIcon } from "@phosphor-icons/react"
import { platformConfig } from "../social/social-config"
import type { SocialPlatform } from "@shared/types"

const PLATFORM_CHAR_LIMITS: Record<string, number> = {
  twitter: 280,
  linkedin: 3000,
  reddit: 40000,
  instagram: 2200,
}
const DEFAULT_CHAR_LIMIT = 5000

interface SocialDraftPreviewProps {
  payloadJson: string
  platform: string
  isPending: boolean
  onScheduleChange?: (scheduledAt: string | null) => void
}

interface DraftPayload {
  content: string
  mediaUrls: string[]
  scheduledAt: string | null
  socialAccountId: string
  platform: string
}

function parseDraft(payloadJson: string): DraftPayload | null {
  try {
    const parsed = JSON.parse(payloadJson)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return {
        content: typeof parsed.content === "string" ? parsed.content : "",
        mediaUrls: Array.isArray(parsed.mediaUrls) ? parsed.mediaUrls : [],
        scheduledAt: typeof parsed.scheduledAt === "string" ? parsed.scheduledAt : null,
        socialAccountId: typeof parsed.socialAccountId === "string" ? parsed.socialAccountId : "",
        platform: typeof parsed.platform === "string" ? parsed.platform : "other",
      }
    }
  } catch { /* invalid JSON */ }
  return null
}

function formatScheduledDate(isoDate: string): string {
  try {
    const d = new Date(isoDate)
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    })
  } catch {
    return isoDate
  }
}

export function SocialDraftPreview({ payloadJson, platform, isPending: _isPending }: SocialDraftPreviewProps) {
  const draft = parseDraft(payloadJson)
  if (!draft) return null

  const platformKey = (draft.platform || platform || "other") as SocialPlatform
  const config = platformConfig[platformKey] ?? platformConfig.other
  const PlatformIcon = config.icon
  const platformColor = config.color
  const charLimit = PLATFORM_CHAR_LIMITS[platformKey] ?? DEFAULT_CHAR_LIMIT
  const charCount = draft.content.length
  const isOverLimit = charCount > charLimit

  return (
    <div
      role="region"
      aria-label="Social post draft preview"
      className="rounded-[8px] border px-4 py-3"
      style={{ borderColor: `${platformColor}4D` }}
    >
      <div className="mb-2 flex items-center gap-2">
        <span
          className="text-[11px] font-semibold uppercase tracking-[0.06em]"
          style={{ color: platformColor }}
        >
          SOCIAL POST DRAFT
        </span>
      </div>

      <div className="mb-3 flex items-center gap-2">
        <PlatformIcon size={16} style={{ color: platformColor }} />
        <span className="text-[13px] font-medium text-[color:var(--text)]">
          {config.label}
        </span>
        {draft.socialAccountId ? (
          <span className="text-[13px] font-[family-name:var(--font-mono)] text-[color:var(--muted)]">
            @{draft.socialAccountId.slice(0, 8)}
          </span>
        ) : null}
      </div>

      <div className="mb-2 max-h-[200px] overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-[color:var(--text)]">
        {draft.content}
      </div>

      <div
        className="mb-2 text-[10px] font-[family-name:var(--font-mono)]"
        style={{ color: isOverLimit ? "var(--danger)" : "var(--muted)" }}
        aria-live="polite"
      >
        {charCount} / {charLimit}{isOverLimit ? " -- over limit" : ""}
      </div>

      {draft.mediaUrls.length > 0 ? (
        <div className="mb-2 space-y-1">
          {draft.mediaUrls.map((url, idx) => (
            <div key={idx} className="flex items-center gap-1.5 text-[11px] text-[color:var(--accent)]">
              <LinkIcon size={12} />
              <span className="truncate max-w-[300px]">{url}</span>
            </div>
          ))}
        </div>
      ) : null}

      {draft.scheduledAt ? (
        <div className="flex items-center gap-1.5 text-[13px] font-[family-name:var(--font-mono)] text-[color:var(--warn)]">
          <Clock size={14} />
          Scheduled: {formatScheduledDate(draft.scheduledAt)}
        </div>
      ) : null}
    </div>
  )
}
